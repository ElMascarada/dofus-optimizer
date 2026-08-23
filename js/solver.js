import { BASE_CHARACTER, SLOT_RULES } from './config.js';
import { addStats, emptyStats, meetsConstraints, stat } from './stats.js';
import { applySetBonuses } from './sets.js';
import { estimateElementValues, evaluateObjectiveUpperBound } from './spells.js';
import { optimizeCharacteristics } from './characteristics.js';
import { FM_ELIGIBLE_SLOTS, optimizeFm } from './fm.js';
import {
  itemConditionCompatibleWithHardConstraints,
  itemConditionsAreValid,
  specialSlotRulesAreValid
} from './build-legality.js';
import {
  buildSuffixCaps,
  collectConditionStatInfo,
  optimisticItemStats,
  pruneDominatedCandidates,
  relevantStatKeys,
  theoreticalChoiceCount
} from './search-space.js';
import { buildParetoChoices } from './pareto-choices.js';
import {
  buildConstraintBundles,
  buildFutureConstraintBundleCaps,
  canMeetJointConstraintBundles
} from './constraint-bounds.js';
import {
  buildCandidateClassifications,
  offensiveDofusPool
} from './offensive-scope.js';

function candidateHeuristic(item, constraints, selections, turnMode, classifications) {
  const optimistic = optimisticItemStats(item, { includePassives: true }).stats;
  let constraintScore = 0;
  for (const [key, minimum] of Object.entries(constraints || {})) {
    if (!(minimum > 0)) continue;
    constraintScore += Math.min(1, Math.max(0, stat(item.stats, key)) / minimum) * 10000;
  }
  const objective = evaluateObjectiveUpperBound({ stats: optimistic, selections, turnMode }).score;
  const directional = Number(classifications?.get(item.id)?.priority || 0);
  return directional + constraintScore + (Number.isFinite(objective) ? objective : 0);
}

function choiceHeuristic(choice, constraints, selections, turnMode, classifications) {
  let constraintScore = 0;
  for (const [key, minimum] of Object.entries(constraints || {})) {
    if (!(minimum > 0)) continue;
    constraintScore += Math.min(1, Math.max(0, stat(choice.stats, key)) / minimum) * 10000;
  }
  const objective = evaluateObjectiveUpperBound({ stats: choice.objectiveStats, selections, turnMode }).score;
  const directional = (choice.items || []).reduce(
    (sum, item) => sum + Number(classifications?.get(item.id)?.priority || 0),
    0
  );
  return directional + constraintScore + (Number.isFinite(objective) ? objective : 0);
}

function maxChoiceStats(choices, keys, field) {
  const result = Object.fromEntries(keys.map((key) => [key, 0]));
  for (const choice of choices || []) {
    for (const key of keys) result[key] = Math.max(result[key], Number(choice?.[field]?.[key] || 0));
  }
  return result;
}

function maxChoiceSetCapacity(choices) {
  const result = new Map();
  for (const choice of choices || []) {
    for (const [setId, count] of Object.entries(choice.setCounts || {})) {
      result.set(setId, Math.max(result.get(setId) || 0, Number(count || 0)));
    }
  }
  return result;
}

function maxCandidateSetCapacity(candidates, count) {
  const counts = new Map();
  for (const item of candidates || []) {
    if (!item?.setId) continue;
    counts.set(item.setId, (counts.get(item.setId) || 0) + 1);
  }
  const result = new Map();
  for (const [setId, available] of counts) result.set(setId, Math.min(Number(count || 0), available));
  return result;
}

function capsForCandidates(candidates, count, keys, includePassives) {
  const caps = buildSuffixCaps(candidates, count, keys, { includePassives });
  return {
    bounded: caps.bounded,
    stats: Object.fromEntries(keys.map((key) => [key, caps.cap(key, 0, count)]))
  };
}

function buildGroups(items, slotRules, keys, nonMonotoneKeys, constraints, selections, turnMode, characterLevel, shouldAbort, classifications) {
  const groups = [];
  let impossible = false;
  let aborted = false;

  for (const rule of slotRules) {
    if (shouldAbort?.()) {
      aborted = true;
      break;
    }

    const sourceCandidates = items.filter((item) => item.slot === rule.id);
    const rawCandidates = sourceCandidates.filter((item) => itemConditionCompatibleWithHardConstraints(item, constraints, characterLevel));
    const conditionFiltered = sourceCandidates.length - rawCandidates.length;

    if (rawCandidates.length < rule.count) {
      groups.push({
        ...rule,
        candidates: rawCandidates,
        choices: [],
        candidatesBefore: sourceCandidates.length,
        conditionFiltered,
        removed: conditionFiltered,
        theoreticalBefore: theoreticalChoiceCount(sourceCandidates.length, rule.count),
        theoreticalAfter: 0n,
        impossible: true,
        pareto: null
      });
      impossible = true;
      continue;
    }

    const pruned = pruneDominatedCandidates(rawCandidates, {
      keys,
      nonMonotoneKeys,
      groupCount: rule.count
    });
    const candidates = pruned.candidates
      .map((item) => ({
        item,
        heuristic: candidateHeuristic(item, constraints, selections, turnMode, classifications)
      }))
      .sort((a, b) => b.heuristic - a.heuristic || String(a.item.id).localeCompare(String(b.item.id)))
      .map((entry) => entry.item);

    if (candidates.length < rule.count) {
      groups.push({
        ...rule,
        candidates,
        choices: [],
        candidatesBefore: sourceCandidates.length,
        conditionFiltered,
        removed: conditionFiltered + pruned.removed,
        equivalentRemoved: pruned.equivalentRemoved,
        dominatedRemoved: pruned.dominatedRemoved,
        theoreticalBefore: theoreticalChoiceCount(sourceCandidates.length, rule.count),
        theoreticalAfter: 0n,
        impossible: true,
        pareto: null
      });
      impossible = true;
      continue;
    }

    // Six Dofus/trophy slots are built lazily once the normal gear is known.
    if (rule.id === 'dofus' && rule.count > 1) {
      const staticCaps = capsForCandidates(candidates, rule.count, keys, false);
      const objectiveCaps = capsForCandidates(candidates, rule.count, keys, true);
      groups.push({
        ...rule,
        dynamic: true,
        candidates,
        choices: null,
        dynamicCache: new Map(),
        dynamicProfiles: [],
        dynamicConditionInfo: collectConditionStatInfo(candidates),
        candidatesBefore: sourceCandidates.length,
        conditionFiltered,
        removed: conditionFiltered + pruned.removed,
        equivalentRemoved: pruned.equivalentRemoved,
        dominatedRemoved: pruned.dominatedRemoved,
        theoreticalBefore: theoreticalChoiceCount(sourceCandidates.length, rule.count),
        theoreticalAfter: theoreticalChoiceCount(candidates.length, rule.count),
        maxStatic: staticCaps.stats,
        maxObjective: objectiveCaps.stats,
        objectiveBounded: objectiveCaps.bounded,
        setCapacity: maxCandidateSetCapacity(candidates, rule.count),
        impossible: false,
        pareto: null
      });
      continue;
    }

    const pareto = buildParetoChoices(candidates, rule.count, keys, { shouldAbort });
    if (pareto.diagnostics.aborted) {
      groups.push({
        ...rule,
        candidates,
        choices: [],
        candidatesBefore: sourceCandidates.length,
        conditionFiltered,
        removed: conditionFiltered + pruned.removed,
        equivalentRemoved: pruned.equivalentRemoved,
        dominatedRemoved: pruned.dominatedRemoved,
        theoreticalBefore: theoreticalChoiceCount(sourceCandidates.length, rule.count),
        theoreticalAfter: theoreticalChoiceCount(candidates.length, rule.count),
        impossible: false,
        pareto: pareto.diagnostics
      });
      aborted = true;
      break;
    }

    const choices = pareto.choices
      .map((choice) => ({
        choice,
        heuristic: choiceHeuristic(choice, constraints, selections, turnMode, classifications)
      }))
      .sort((a, b) => b.heuristic - a.heuristic || String(a.choice.items[0]?.id || '').localeCompare(String(b.choice.items[0]?.id || '')))
      .map((entry) => entry.choice);

    groups.push({
      ...rule,
      dynamic: false,
      candidates,
      choices,
      candidatesBefore: sourceCandidates.length,
      conditionFiltered,
      removed: conditionFiltered + pruned.removed,
      equivalentRemoved: pruned.equivalentRemoved,
      dominatedRemoved: pruned.dominatedRemoved,
      theoreticalBefore: theoreticalChoiceCount(sourceCandidates.length, rule.count),
      theoreticalAfter: theoreticalChoiceCount(candidates.length, rule.count),
      maxStatic: maxChoiceStats(choices, keys, 'stats'),
      maxObjective: maxChoiceStats(choices, keys, 'objectiveStats'),
      objectiveBounded: choices.every((choice) => choice.bounded),
      setCapacity: maxChoiceSetCapacity(choices),
      impossible: !choices.length,
      pareto: pareto.diagnostics
    });
    if (!choices.length) impossible = true;
  }

  if (!aborted) {
    groups.sort((a, b) => {
      if (Boolean(a.dynamic) !== Boolean(b.dynamic)) return a.dynamic ? 1 : -1;
      const aChoices = a.choices?.length || Number.MAX_SAFE_INTEGER;
      const bChoices = b.choices?.length || Number.MAX_SAFE_INTEGER;
      return aChoices - bChoices || a.id.localeCompare(b.id);
    });
  }

  return { groups, impossible, aborted };
}

function buildFutureCaps(groups, keys, field) {
  const suffix = new Array(groups.length + 1);
  suffix[groups.length] = Object.fromEntries(keys.map((key) => [key, 0]));
  for (let index = groups.length - 1; index >= 0; index--) {
    const row = {};
    for (const key of keys) row[key] = Number(suffix[index + 1][key] || 0) + Number(groups[index]?.[field]?.[key] || 0);
    suffix[index] = row;
  }
  return suffix;
}

function buildFuturePicks(groups) {
  const suffix = new Array(groups.length + 1).fill(0);
  for (let index = groups.length - 1; index >= 0; index--) suffix[index] = suffix[index + 1] + Number(groups[index].count || 0);
  return suffix;
}

function buildFutureSetCapacity(groups) {
  const suffix = new Array(groups.length + 1);
  suffix[groups.length] = new Map();
  for (let index = groups.length - 1; index >= 0; index--) {
    const map = new Map(suffix[index + 1]);
    for (const [setId, count] of groups[index].setCapacity || []) {
      map.set(setId, (map.get(setId) || 0) + Number(count || 0));
    }
    suffix[index] = map;
  }
  return suffix;
}

function setBonusUpperStats(setCounts, remainingCapacity, setsById, keys, remainingPicks) {
  const valuesByKey = Object.fromEntries(keys.map((key) => [key, []]));
  const ids = new Set([...setCounts.keys(), ...remainingCapacity.keys()]);

  for (const setId of ids) {
    const set = setsById[setId];
    if (!set) continue;
    const selected = Number(setCounts.get(setId) || 0);
    const maximum = selected + Number(remainingCapacity.get(setId) || 0);
    if (maximum <= 0) continue;

    const best = Object.fromEntries(keys.map((key) => [key, 0]));
    for (const [countText, bonus] of Object.entries(set.bonuses || {})) {
      const count = Number(countText);
      if (!Number.isFinite(count) || count < selected || count > maximum) continue;
      for (const key of keys) best[key] = Math.max(best[key], Number(bonus?.[key] || 0));
    }
    for (const key of keys) if (best[key] > 0) valuesByKey[key].push(best[key]);
  }

  const maxPotentialSets = Math.max(0, setCounts.size + remainingPicks);
  const result = {};
  for (const key of keys) {
    valuesByKey[key].sort((a, b) => b - a);
    result[key] = valuesByKey[key].slice(0, maxPotentialSets).reduce((sum, value) => sum + value, 0);
  }
  return result;
}

function characterUpperStats(character) {
  const points = Math.max(0, Number(character.characteristicPoints || 0));
  const result = { vit: points };
  for (const element of ['earth', 'fire', 'water', 'air']) {
    result[element] = points + Math.max(0, Number(character.scrolled?.[element] || 0));
  }
  return result;
}

function fmUpperStats(groups, fmPolicy) {
  let forgeableCount = 0;
  for (const group of groups) if (FM_ELIGIBLE_SLOTS.has(group.id)) forgeableCount += Number(group.count || 0);
  return {
    spellDamagePct: forgeableCount * Math.max(0, Number(fmPolicy?.spellDamagePct || 0)),
    critDamage: fmPolicy?.allowCritDamage ? forgeableCount * Math.max(0, Number(fmPolicy?.critDamageAmount || 0)) : 0
  };
}

function canStillMeetConstraints(rawStats, constraints, remainingStatic, setUpper, charUpper, fmUpper) {
  for (const [key, minimum] of Object.entries(constraints || {})) {
    if (!Number.isFinite(minimum) || minimum <= 0) continue;
    const possible = stat(rawStats, key)
      + Number(remainingStatic?.[key] || 0)
      + Number(setUpper?.[key] || 0)
      + Number(charUpper?.[key] || 0)
      + Number(fmUpper?.[key] || 0);
    if (possible < minimum) return false;
  }
  return true;
}

function insertTop(results, result, limit) {
  results.push(result);
  results.sort((a, b) => b.score - a.score);
  if (results.length > limit) results.length = limit;
}

function diagnosticsForGroups(groups) {
  return groups.map((group) => ({
    id: group.id,
    count: group.count,
    dynamic: Boolean(group.dynamic),
    candidatesBefore: group.candidatesBefore,
    candidates: group.candidates?.length || 0,
    choices: group.dynamic
      ? [...(group.dynamicCache?.values?.() || [])].reduce((sum, value) => sum + (value.choices?.length || 0), 0)
      : (group.choices?.length || 0),
    cachedProfiles: group.dynamicCache?.size || 0,
    dynamicProfiles: group.dynamicProfiles || [],
    removed: group.removed || 0,
    conditionFiltered: group.conditionFiltered || 0,
    dominatedRemoved: group.dominatedRemoved || 0,
    equivalentRemoved: group.equivalentRemoved || 0,
    theoreticalChoicesBefore: group.theoreticalBefore?.toString?.() || '0',
    theoreticalChoices: group.theoreticalAfter?.toString?.() || '0',
    materializedChoices: group.dynamic
      ? [...(group.dynamicCache?.values?.() || [])].reduce((sum, value) => sum + (value.choices?.length || 0), 0)
      : (group.choices?.length || 0),
    paretoPartitions: group.pareto?.partitions || 0,
    paretoGenerated: group.pareto?.generated || 0,
    paretoDominatedRemoved: group.pareto?.dominatedRemoved || 0,
    paretoEquivalentRemoved: group.pareto?.equivalentRemoved || 0
  }));
}

function setCountsSignature(setCounts) {
  return [...setCounts.entries()]
    .sort(([a], [b]) => String(a).localeCompare(String(b)))
    .map(([setId, count]) => `${setId}:${count}`)
    .join('|');
}

function applyChoice(choice, selectedItems, selectedIds, rawStats, selectedPassiveUpper, setCounts) {
  for (const item of choice.items) {
    selectedItems.push(item);
    selectedIds.add(item.id);
    addStats(rawStats, item.stats || {});
  }
  addStats(selectedPassiveUpper, choice.passiveUpper || {});
  for (const [setId, count] of Object.entries(choice.setCounts || {})) {
    setCounts.set(setId, (setCounts.get(setId) || 0) + Number(count || 0));
  }
}

function revertChoice(choice, selectedItems, selectedIds, rawStats, selectedPassiveUpper, setCounts) {
  for (const [setId, count] of Object.entries(choice.setCounts || {})) {
    const next = (setCounts.get(setId) || 0) - Number(count || 0);
    if (next <= 0) setCounts.delete(setId);
    else setCounts.set(setId, next);
  }
  addStats(selectedPassiveUpper, choice.passiveUpper || {}, -1);
  for (let index = choice.items.length - 1; index >= 0; index--) {
    const item = choice.items[index];
    addStats(rawStats, item.stats || {}, -1);
    selectedIds.delete(item.id);
    selectedItems.pop();
  }
}

function scopeDiagnostics(items, scopedItems, classifications) {
  const roleCounts = {};
  for (const item of items || []) {
    if (item.slot !== 'dofus') continue;
    const role = classifications.get(item.id)?.role || 'unknown';
    roleCounts[role] = (roleCounts[role] || 0) + 1;
  }
  return {
    itemsBefore: items?.length || 0,
    itemsAfter: scopedItems?.length || 0,
    dofusBefore: (items || []).filter((item) => item.slot === 'dofus').length,
    dofusAfter: (scopedItems || []).filter((item) => item.slot === 'dofus').length,
    dofusRoles: roleCounts
  };
}

export function optimizeBuild({
  items,
  sets = [],
  selections,
  constraints,
  fmPolicy,
  turnMode = 'sum',
  topN = 10,
  slotRules = SLOT_RULES,
  character = BASE_CHARACTER,
  scenario = {},
  onProgress = null,
  shouldAbort = null
}) {
  const limit = Math.max(1, Number(topN || 1));
  const scope = buildCandidateClassifications(items, sets, selections, turnMode, constraints);
  const scopedItems = offensiveDofusPool(items, scope.byId);
  const relevant = relevantStatKeys({ items: scopedItems, selections, constraints });
  const queryRelevant = relevantStatKeys({ items: [], selections, constraints });
  const prepared = buildGroups(
    scopedItems,
    slotRules,
    relevant.keys,
    relevant.nonMonotoneKeys,
    constraints,
    selections,
    turnMode,
    character.level,
    shouldAbort,
    scope.byId
  );
  const groups = prepared.groups;
  const offensiveScope = scopeDiagnostics(items, scopedItems, scope.byId);

  function baseDiagnostics(extra = {}) {
    return {
      visited: 0,
      nodes: 0,
      pruned: 0,
      prunedConstraints: 0,
      prunedScore: 0,
      prunedSpecial: 0,
      impossible: false,
      aborted: false,
      offensiveScope,
      groups: diagnosticsForGroups(groups),
      searchOrder: groups.map((group) => group.id),
      ...extra
    };
  }

  if (prepared.aborted) return { results: [], diagnostics: baseDiagnostics({ aborted: true }) };
  if (prepared.impossible) return { results: [], diagnostics: baseDiagnostics({ impossible: true }) };

  const setsById = Object.fromEntries(sets.map((set) => [set.id, set]));
  const futureStaticCaps = buildFutureCaps(groups, relevant.keys, 'maxStatic');
  const futureObjectiveCaps = buildFutureCaps(groups, relevant.keys, 'maxObjective');
  const futurePicks = buildFuturePicks(groups);
  const futureSetCapacity = buildFutureSetCapacity(groups);
  const constraintBundles = buildConstraintBundles(constraints);
  const futureConstraintBundleCaps = buildFutureConstraintBundleCaps(groups, constraintBundles);
  const charUpper = characterUpperStats(character);
  const fmUpper = fmUpperStats(groups, fmPolicy);
  const results = [];
  const selectedItems = [];
  const selectedIds = new Set();
  const setCounts = new Map();
  const selectedPassiveUpper = emptyStats();
  const rawStats = emptyStats();
  addStats(rawStats, character.baseStats || {});

  const elementValues = estimateElementValues(selections, {});
  const setUpperCache = new Map();
  let nodes = 0;
  let visited = 0;
  let prunedConstraints = 0;
  let prunedScore = 0;
  let prunedSpecial = 0;
  let rejectedConditions = 0;
  let rejectedUnresolvedPassives = 0;
  let aborted = false;
  let selectedUnboundedChoices = 0;

  const objectiveSuffixBounded = new Array(groups.length + 1).fill(true);
  for (let index = groups.length - 1; index >= 0; index--) {
    objectiveSuffixBounded[index] = objectiveSuffixBounded[index + 1] && groups[index].objectiveBounded;
  }

  function reportProgress() {
    if (!onProgress || nodes % 1000 !== 0) return;
    onProgress({
      nodes,
      visited,
      pruned: prunedConstraints + prunedScore + prunedSpecial,
      best: results[0]?.score || 0,
      threshold: results.length >= limit ? results[results.length - 1].score : null
    });
  }

  function checkAbort(force = false) {
    if (!shouldAbort) return false;
    if (!force && nodes % 512 !== 0) return false;
    if (shouldAbort()) {
      aborted = true;
      return true;
    }
    return false;
  }

  function setUpperFor(groupIndex) {
    const cacheKey = `${groupIndex}|${setCountsSignature(setCounts)}`;
    const cached = setUpperCache.get(cacheKey);
    if (cached) return cached;
    const value = setBonusUpperStats(
      setCounts,
      futureSetCapacity[groupIndex] || new Map(),
      setsById,
      relevant.keys,
      Number(futurePicks[groupIndex] || 0)
    );
    setUpperCache.set(cacheKey, value);
    return value;
  }

  function boundState(groupIndex) {
    const setUpper = setUpperFor(groupIndex);

    if (!canStillMeetConstraints(rawStats, constraints, futureStaticCaps[groupIndex], setUpper, charUpper, fmUpper)) {
      prunedConstraints++;
      return false;
    }

    if (!canMeetJointConstraintBundles({
      rawStats,
      bundles: constraintBundles,
      futureCaps: futureConstraintBundleCaps[groupIndex] || {},
      setUpper,
      charUpper,
      fmUpper
    })) {
      prunedConstraints++;
      return false;
    }

    if (results.length >= limit && selectedUnboundedChoices === 0 && objectiveSuffixBounded[groupIndex]) {
      const optimisticStats = { ...rawStats };
      addStats(optimisticStats, futureObjectiveCaps[groupIndex] || {});
      addStats(optimisticStats, setUpper);
      addStats(optimisticStats, charUpper);
      addStats(optimisticStats, fmUpper);
      addStats(optimisticStats, selectedPassiveUpper);
      const upper = evaluateObjectiveUpperBound({ stats: optimisticStats, selections, turnMode }).score;
      const threshold = results[results.length - 1].score;
      if (Number.isFinite(upper) && upper <= threshold) {
        prunedScore++;
        return false;
      }
    }
    return true;
  }

  function evaluateLeaf() {
    visited++;
    const statsWithSets = { ...rawStats };
    const activeSets = applySetBonuses(statsWithSets, selectedItems, setsById);

    const charResult = optimizeCharacteristics(statsWithSets, {
      points: character.characteristicPoints,
      scrolled: character.scrolled,
      elementValues,
      minimumVitality: constraints.vit || 0,
      baseVitality: 0
    });

    if (!meetsConstraints(charResult.stats, constraints)) return;
    if (!itemConditionsAreValid(selectedItems, charResult.stats, character.level)) {
      rejectedConditions++;
      return;
    }

    const fm = optimizeFm({
      baseStats: charResult.stats,
      items: selectedItems,
      selections,
      turnMode,
      policy: fmPolicy,
      scenario
    });
    if (!fm || fm.objective.unresolvedPassiveContexts?.length) {
      rejectedUnresolvedPassives++;
      return;
    }
    if (!meetsConstraints(fm.stats, constraints)) return;

    insertTop(results, {
      score: fm.objective.score,
      perTurn: fm.objective.perTurn,
      items: [...selectedItems],
      stats: fm.stats,
      characteristics: charResult.allocation,
      fm: {
        critItems: fm.critItems,
        spellPctItems: fm.spellPctItems,
        assignments: fm.assignments
      },
      activeSets
    }, limit);
  }

  function dynamicChoicesFor(group) {
    const selectedConditionInfo = collectConditionStatInfo(selectedItems);
    const keys = new Set(queryRelevant.keys);
    for (const key of selectedConditionInfo.all) keys.add(key);
    for (const key of group.dynamicConditionInfo?.all || []) keys.add(key);
    const keyList = [...keys].sort();

    const nonMonotone = new Set(queryRelevant.nonMonotoneKeys || []);
    for (const key of selectedConditionInfo.nonMonotone || []) nonMonotone.add(key);
    for (const key of group.dynamicConditionInfo?.nonMonotone || []) nonMonotone.add(key);
    const cacheKey = `${keyList.join(',')}|nm:${[...nonMonotone].sort().join(',')}`;
    const cached = group.dynamicCache.get(cacheKey);
    if (cached) return cached.choices;

    const repruned = pruneDominatedCandidates(group.candidates, {
      keys: keyList,
      nonMonotoneKeys: nonMonotone,
      groupCount: group.count
    });
    const pareto = buildParetoChoices(repruned.candidates, group.count, keyList, { shouldAbort });
    if (pareto.diagnostics.aborted) {
      aborted = true;
      group.dynamicProfiles.push({
        keys: keyList,
        candidates: repruned.candidates.length,
        choices: 0,
        aborted: true,
        generated: pareto.diagnostics.generated,
        partitions: pareto.diagnostics.partitions,
        partitionProfiles: pareto.diagnostics.partitionProfiles || []
      });
      return [];
    }

    const choices = pareto.choices
      .map((choice) => ({
        choice,
        heuristic: choiceHeuristic(choice, constraints, selections, turnMode, scope.byId)
      }))
      .sort((a, b) => b.heuristic - a.heuristic || String(a.choice.items[0]?.id || '').localeCompare(String(b.choice.items[0]?.id || '')))
      .map((entry) => entry.choice);

    const profile = {
      keys: keyList,
      candidates: repruned.candidates.length,
      choices: choices.length,
      aborted: false,
      generated: pareto.diagnostics.generated,
      partitions: pareto.diagnostics.partitions,
      partitionProfiles: pareto.diagnostics.partitionProfiles || []
    };
    group.dynamicProfiles.push(profile);
    group.dynamicCache.set(cacheKey, { choices, profile });
    return choices;
  }

  function visitGroup(groupIndex) {
    if (aborted) return;
    nodes++;
    reportProgress();
    if (checkAbort()) return;

    if (groupIndex >= groups.length) {
      evaluateLeaf();
      return;
    }
    if (!boundState(groupIndex)) return;

    const group = groups[groupIndex];
    const choices = group.dynamic ? dynamicChoicesFor(group) : group.choices;
    if (aborted) return;

    for (const choice of choices || []) {
      if (aborted) break;
      if (choice.items.some((item) => selectedIds.has(item.id))) continue;

      applyChoice(choice, selectedItems, selectedIds, rawStats, selectedPassiveUpper, setCounts);
      if (!choice.bounded) selectedUnboundedChoices++;

      if (specialSlotRulesAreValid(selectedItems)) visitGroup(groupIndex + 1);
      else prunedSpecial++;

      if (!choice.bounded) selectedUnboundedChoices--;
      revertChoice(choice, selectedItems, selectedIds, rawStats, selectedPassiveUpper, setCounts);
    }
  }

  visitGroup(0);
  const pruned = prunedConstraints + prunedScore + prunedSpecial;
  return {
    results,
    diagnostics: {
      visited,
      nodes,
      pruned,
      prunedConstraints,
      prunedScore,
      prunedSpecial,
      rejectedConditions,
      rejectedUnresolvedPassives,
      impossible: false,
      aborted,
      offensiveScope,
      setBoundCacheEntries: setUpperCache.size,
      jointConstraintBundles: constraintBundles.map((bundle) => bundle.id),
      groups: diagnosticsForGroups(groups),
      searchOrder: groups.map((group) => group.id)
    }
  };
}
