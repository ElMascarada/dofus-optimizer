import { BASE_CHARACTER, SLOT_RULES } from './config.js';
import { addStats, emptyStats, stat } from './stats.js';
import { applySetBonuses } from './sets.js';
import { estimateElementValues, evaluateObjectiveUpperBound, evaluateTurnConstraints } from './spells.js';
import { optimizeCharacteristics } from './characteristics.js';
import { FM_ELIGIBLE_SLOTS, optimizeFm } from './fm.js';
import { itemConditionsAreValid, specialSlotRulesAreValid } from './build-legality.js';
import {
  buildSuffixCaps,
  optimisticItemStats,
  passiveUpperStats,
  pruneDominatedCandidates,
  relevantStatKeys,
  theoreticalChoiceCount
} from './search-space.js';

function candidateHeuristic(item, constraints, selections, turnMode, scenario) {
  const optimistic = optimisticItemStats(item, { includePassives: true, turnMode, scenario }).stats;
  let constraintScore = 0;
  for (const [key, minimum] of Object.entries(constraints || {})) {
    if (!(minimum > 0)) continue;
    constraintScore += Math.min(1, Math.max(0, stat(optimistic, key)) / minimum) * 10000;
  }
  const objective = evaluateObjectiveUpperBound({ stats: optimistic, selections, turnMode }).score;
  return constraintScore + (Number.isFinite(objective) ? objective : 0);
}

function buildSetSuffixCounts(candidates) {
  const setIds = new Set(candidates.map((item) => item.setId).filter(Boolean));
  const map = new Map();
  for (const setId of setIds) {
    const suffix = new Int32Array(candidates.length + 1);
    for (let index = candidates.length - 1; index >= 0; index--) {
      suffix[index] = suffix[index + 1] + (candidates[index].setId === setId ? 1 : 0);
    }
    map.set(setId, suffix);
  }
  return map;
}

function buildGroups(items, slotRules, keys, nonMonotoneKeys, constraints, selections, turnMode, scenario) {
  const groups = [];
  let impossible = false;

  for (const rule of slotRules) {
    const rawCandidates = items.filter((item) => item.slot === rule.id);
    if (rawCandidates.length < rule.count) {
      groups.push({
        ...rule,
        candidates: rawCandidates,
        candidatesBefore: rawCandidates.length,
        removed: 0,
        theoreticalBefore: theoreticalChoiceCount(rawCandidates.length, rule.count),
        theoreticalAfter: 0n,
        impossible: true
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
      .map((item) => ({ item, heuristic: candidateHeuristic(item, constraints, selections, turnMode, scenario) }))
      .sort((a, b) => b.heuristic - a.heuristic || String(a.item.id).localeCompare(String(b.item.id)))
      .map((entry) => entry.item);

    if (candidates.length < rule.count) impossible = true;
    const staticCaps = buildSuffixCaps(candidates, rule.count, keys, { includePassives: false });
    const objectiveCaps = buildSuffixCaps(candidates, rule.count, keys, {
      includePassives: true,
      turnMode,
      scenario
    });

    groups.push({
      ...rule,
      candidates,
      candidatesBefore: rawCandidates.length,
      removed: pruned.removed,
      equivalentRemoved: pruned.equivalentRemoved,
      dominatedRemoved: pruned.dominatedRemoved,
      theoreticalBefore: theoreticalChoiceCount(rawCandidates.length, rule.count),
      theoreticalAfter: theoreticalChoiceCount(candidates.length, rule.count),
      staticCaps,
      objectiveCaps,
      setSuffixCounts: buildSetSuffixCounts(candidates),
      impossible: candidates.length < rule.count
    });
  }

  groups.sort((a, b) => {
    const aMulti = a.count > 1 ? 1 : 0;
    const bMulti = b.count > 1 ? 1 : 0;
    if (aMulti !== bMulti) return aMulti - bMulti;
    return a.candidates.length - b.candidates.length || a.id.localeCompare(b.id);
  });

  return { groups, impossible };
}

function buildFutureCaps(groups, keys, capName) {
  const suffix = new Array(groups.length + 1);
  suffix[groups.length] = Object.fromEntries(keys.map((key) => [key, 0]));
  for (let index = groups.length - 1; index >= 0; index--) {
    const current = {};
    for (const key of keys) {
      current[key] = Number(suffix[index + 1][key] || 0) + groups[index][capName].cap(key, 0, groups[index].count);
    }
    suffix[index] = current;
  }
  return suffix;
}

function buildFuturePicks(groups) {
  const suffix = new Array(groups.length + 1).fill(0);
  for (let index = groups.length - 1; index >= 0; index--) suffix[index] = suffix[index + 1] + groups[index].count;
  return suffix;
}

function buildFutureSetCapacity(groups) {
  const suffix = new Array(groups.length + 1);
  suffix[groups.length] = new Map();
  for (let index = groups.length - 1; index >= 0; index--) {
    const map = new Map(suffix[index + 1]);
    const group = groups[index];
    for (const [setId, counts] of group.setSuffixCounts || []) {
      const capacity = Math.min(group.count, Number(counts[0] || 0));
      if (capacity > 0) map.set(setId, (map.get(setId) || 0) + capacity);
    }
    suffix[index] = map;
  }
  return suffix;
}

function remainingSetCapacity(group, futureCapacity, start, picksLeft) {
  const map = new Map(futureCapacity || []);
  if (!group) return map;
  for (const [setId, counts] of group.setSuffixCounts || []) {
    const capacity = Math.min(picksLeft, Number(counts[Math.max(0, start)] || 0));
    if (capacity > 0) map.set(setId, (map.get(setId) || 0) + capacity);
  }
  return map;
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
  for (const group of groups) if (FM_ELIGIBLE_SLOTS.has(group.id)) forgeableCount += group.count;
  return {
    spellDamagePct: forgeableCount * Math.max(0, Number(fmPolicy?.spellDamagePct || 0)),
    critDamage: fmPolicy?.allowCritDamage ? forgeableCount * Math.max(0, Number(fmPolicy?.critDamageAmount || 0)) : 0
  };
}

function sumInto(target, ...sources) {
  for (const source of sources) addStats(target, source || {});
  return target;
}

function canStillMeetConstraints(rawStats, constraints, remainingOptimistic, setUpper, charUpper, fmUpper) {
  for (const [key, minimum] of Object.entries(constraints || {})) {
    if (!Number.isFinite(minimum) || minimum <= 0) continue;
    const possible = stat(rawStats, key)
      + Number(remainingOptimistic?.[key] || 0)
      + Number(setUpper?.[key] || 0)
      + Number(charUpper?.[key] || 0)
      + Number(fmUpper?.[key] || 0);
    if (possible < minimum) return false;
  }
  return true;
}

function resultKey(result) {
  return (result?.items || []).map((item) => String(item.id)).sort().join('|');
}

function insertTop(results, result, limit) {
  const key = resultKey(result);
  const duplicateIndex = results.findIndex((entry) => resultKey(entry) === key);
  if (duplicateIndex >= 0) {
    if (results[duplicateIndex].score >= result.score) return;
    results.splice(duplicateIndex, 1);
  }
  results.push(result);
  results.sort((a, b) => b.score - a.score);
  if (results.length > limit) results.length = limit;
}

function diagnosticsForGroups(groups) {
  return groups.map((group) => ({
    id: group.id,
    count: group.count,
    candidatesBefore: group.candidatesBefore,
    candidates: group.candidates.length,
    removed: group.removed || 0,
    dominatedRemoved: group.dominatedRemoved || 0,
    equivalentRemoved: group.equivalentRemoved || 0,
    theoreticalChoicesBefore: group.theoreticalBefore.toString(),
    theoreticalChoices: group.theoreticalAfter.toString(),
    materializedChoices: 0
  }));
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
  initialResults = [],
  onProgress = null,
  shouldAbort = null
}) {
  const limit = Math.max(1, Number(topN || 1));
  const relevant = relevantStatKeys({ items, selections, constraints });
  const prepared = buildGroups(
    items,
    slotRules,
    relevant.keys,
    relevant.nonMonotoneKeys,
    constraints,
    selections,
    turnMode,
    scenario
  );
  const groups = prepared.groups;
  const groupDiagnostics = diagnosticsForGroups(groups);

  if (prepared.impossible) {
    return {
      results: [],
      diagnostics: {
        visited: 0,
        nodes: 0,
        pruned: 0,
        prunedConstraints: 0,
        prunedScore: 0,
        prunedSpecial: 0,
        impossible: true,
        aborted: false,
        seeded: 0,
        groups: groupDiagnostics
      }
    };
  }

  const setsById = Object.fromEntries(sets.map((set) => [set.id, set]));
  const futureObjectiveCaps = buildFutureCaps(groups, relevant.keys, 'objectiveCaps');
  const futurePicks = buildFuturePicks(groups);
  const futureSetCapacity = buildFutureSetCapacity(groups);
  const charUpper = characterUpperStats(character);
  const fmUpper = fmUpperStats(groups, fmPolicy);
  const results = [];
  for (const seed of initialResults || []) {
    if (seed?.items?.length) insertTop(results, seed, limit);
  }
  const seededCount = results.length;
  const selectedItems = [];
  const selectedIds = new Set();
  const setCounts = new Map();
  const selectedPassiveUpper = emptyStats();
  const rawStats = emptyStats();
  addStats(rawStats, character.baseStats || {});

  const elementValues = estimateElementValues(selections, {});
  let nodes = 0;
  let visited = 0;
  let prunedConstraints = 0;
  let prunedScore = 0;
  let prunedSpecial = 0;
  let rejectedConditions = 0;
  let rejectedUnresolvedPassives = 0;
  let aborted = false;
  let selectedUnboundedPassives = 0;

  const objectiveSuffixBounded = new Array(groups.length + 1).fill(true);
  for (let index = groups.length - 1; index >= 0; index--) {
    objectiveSuffixBounded[index] = objectiveSuffixBounded[index + 1] && groups[index].objectiveCaps.bounded;
  }

  function reportProgress() {
    if (!onProgress || nodes % 5000 !== 0) return;
    onProgress({
      nodes,
      visited,
      pruned: prunedConstraints + prunedScore + prunedSpecial,
      best: results[0]?.score || 0,
      threshold: results.length >= limit ? results[results.length - 1].score : null,
      partialResults: nodes % 25000 === 0 && results.length ? [...results] : null
    });
  }

  function checkAbort() {
    if (!shouldAbort || nodes % 1024 !== 0) return false;
    if (shouldAbort()) {
      aborted = true;
      return true;
    }
    return false;
  }

  function boundState(groupIndex, start, picksLeft) {
    const group = groups[groupIndex] || null;
    const remainingObjective = {};
    for (const key of relevant.keys) {
      remainingObjective[key] = Number(futureObjectiveCaps[groupIndex + 1]?.[key] || 0)
        + (group ? group.objectiveCaps.cap(key, start, picksLeft) : 0);
    }

    const remainingPicks = Number(futurePicks[groupIndex + 1] || 0) + picksLeft;
    const remainingSets = remainingSetCapacity(group, futureSetCapacity[groupIndex + 1], start, picksLeft);
    const setUpper = setBonusUpperStats(setCounts, remainingSets, setsById, relevant.keys, remainingPicks);
    const optimisticConstraintStats = emptyStats();
    sumInto(optimisticConstraintStats, rawStats, selectedPassiveUpper);

    if (!canStillMeetConstraints(optimisticConstraintStats, constraints, remainingObjective, setUpper, charUpper, fmUpper)) {
      prunedConstraints++;
      return false;
    }

    if (results.length >= limit && selectedUnboundedPassives === 0 && objectiveSuffixBounded[groupIndex]) {
      const optimisticStats = emptyStats();
      sumInto(optimisticStats, rawStats, remainingObjective, setUpper, charUpper, fmUpper, selectedPassiveUpper);
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

    const turnConstraints = evaluateTurnConstraints({
      stats: fm.stats,
      items: selectedItems,
      constraints,
      selections,
      turnMode,
      scenario
    });
    if (turnConstraints.unresolvedPassiveContexts.length) {
      rejectedUnresolvedPassives++;
      return;
    }
    if (!turnConstraints.meets) return;

    insertTop(results, {
      score: fm.objective.score,
      perTurn: fm.objective.perTurn,
      items: [...selectedItems],
      stats: fm.stats,
      effectiveStatsByTurn: turnConstraints.perTurn,
      characteristics: charResult.allocation,
      fm: {
        critItems: fm.critItems,
        spellPctItems: fm.spellPctItems,
        assignments: fm.assignments
      },
      activeSets
    }, limit);
  }

  function chooseFromGroup(groupIndex, start, picksLeft) {
    if (aborted) return;
    nodes++;
    reportProgress();
    if (checkAbort()) return;

    const group = groups[groupIndex];
    if (picksLeft === 0) {
      visitGroup(groupIndex + 1);
      return;
    }
    if (!group || group.candidates.length - start < picksLeft) return;
    if (!boundState(groupIndex, start, picksLeft)) return;

    const lastStart = group.candidates.length - picksLeft;
    for (let index = start; index <= lastStart && !aborted; index++) {
      const item = group.candidates[index];
      if (selectedIds.has(item.id)) continue;

      selectedItems.push(item);
      selectedIds.add(item.id);
      addStats(rawStats, item.stats || {});
      const passive = passiveUpperStats(item, { turnMode, scenario });
      addStats(selectedPassiveUpper, passive.stats);
      if (!passive.bounded) selectedUnboundedPassives++;
      if (item.setId) setCounts.set(item.setId, (setCounts.get(item.setId) || 0) + 1);

      if (specialSlotRulesAreValid(selectedItems)) chooseFromGroup(groupIndex, index + 1, picksLeft - 1);
      else prunedSpecial++;

      if (item.setId) {
        const next = (setCounts.get(item.setId) || 1) - 1;
        if (next <= 0) setCounts.delete(item.setId);
        else setCounts.set(item.setId, next);
      }
      if (!passive.bounded) selectedUnboundedPassives--;
      addStats(selectedPassiveUpper, passive.stats, -1);
      addStats(rawStats, item.stats || {}, -1);
      selectedIds.delete(item.id);
      selectedItems.pop();
    }
  }

  function visitGroup(groupIndex) {
    if (aborted) return;
    if (groupIndex >= groups.length) {
      evaluateLeaf();
      return;
    }
    chooseFromGroup(groupIndex, 0, groups[groupIndex].count);
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
      seeded: seededCount,
      groups: groupDiagnostics,
      searchOrder: groups.map((group) => group.id)
    }
  };
}
