import { BASE_CHARACTER, SLOT_RULES } from '../js/config.js';
import { addStats, effectiveStat, emptyStats } from '../js/stats.js';
import { applySetBonuses } from '../js/sets.js';
import { specialSlotRulesAreValid } from '../js/build-legality.js';
import { statsWithStructuralExos } from '../js/structural-exos.js';
import {
  compareCompleteEquipmentBuildResults,
  evaluateCompleteEquipmentBuild
} from '../js/complete-equipment-build-evaluator.js';
import {
  buildEquipmentCandidatePools,
  positiveEquipmentConstraintKeys
} from './equipment-candidate-policy.js';
import { filterOptimizerEligibleItems } from './item-eligibility.js';
import { buildSetCoreCatalog } from './set-core-catalog.js';

const CORE_PATTERNS = Object.freeze([
  [4, 3, 2],
  [4, 3],
  [4, 2, 2],
  [3, 3, 3],
  [3, 3, 2],
  [3, 2, 2],
  [3, 3],
  [3, 2],
  [2, 2, 2],
  []
]);

const CORE_POOL_LIMIT = Object.freeze({ 2: 48, 3: 42, 4: 34 });
const CORE_BEAM_LIMIT = 90;
const PER_PATTERN_LIMIT = 32;
const SLOT_BEAM_LIMIT = 36;
const EQUIPMENT_LIMIT = 80;
const CONTEXT_LIMIT = 36;
const DOFUS_POOL_LIMIT = 12;
const DOFUS_COMPLETION_LIMIT = 10;

function itemKey(items = []) {
  return (items || []).map((item) => String(item?.id ?? '')).sort().join('|');
}

function setsByIdFor(sets = []) {
  return Object.fromEntries((sets || []).map((set) => [set.id, set]));
}

function equipmentStats(items = [], setsById = {}) {
  const stats = emptyStats();
  for (const item of items || []) addStats(stats, item?.stats || {});
  applySetBonuses(stats, items, setsById);
  return stats;
}

function contextualStats(items = [], setsById = {}, fmPolicy = {}) {
  const stats = emptyStats();
  addStats(stats, BASE_CHARACTER.baseStats || {});
  for (const item of items || []) addStats(stats, item?.stats || {});
  applySetBonuses(stats, items, setsById);
  return statsWithStructuralExos(stats, fmPolicy).stats;
}

function slotCapacities() {
  return new Map(SLOT_RULES.map((rule) => [rule.id, Number(rule.count || 0)]));
}

function slotCounts(items = []) {
  const counts = new Map();
  for (const item of items || []) counts.set(item?.slot, Number(counts.get(item?.slot) || 0) + 1);
  return counts;
}

function withinSlotCaps(items = [], capacities = slotCapacities()) {
  const counts = slotCounts(items);
  for (const [slot, count] of counts) if (count > Number(capacities.get(slot) || 0)) return false;
  return specialSlotRulesAreValid(items);
}

function choose(values, count) {
  const output = [];
  const chosen = [];
  function visit(start) {
    if (chosen.length === count) {
      output.push([...chosen]);
      return;
    }
    const remaining = count - chosen.length;
    for (let index = start; index <= values.length - remaining; index++) {
      chosen.push(values[index]);
      visit(index + 1);
      chosen.pop();
    }
  }
  visit(0);
  return output;
}

function branchAllows(item, branch) {
  const name = String(item?.name || '');
  if (branch === 'CRIT' && /^Robuste(?: majeur)?$/i.test(name)) return false;
  if (branch === 'NO_CRIT' && /^Dofus Turquoise$/i.test(name)) return false;
  return true;
}

function branchesForCritMode(critMode) {
  if (critMode === 'crit') return ['CRIT'];
  if (critMode === 'no_crit') return ['NO_CRIT'];
  return ['CRIT', 'NO_CRIT'];
}

function insertResult(results, candidate, topN) {
  if (!candidate) return;
  const previous = results.findIndex((entry) => entry.buildIdentity === candidate.buildIdentity);
  if (previous >= 0) results.splice(previous, 1);
  results.push(candidate);
  results.sort((left, right) => -compareCompleteEquipmentBuildResults(left, right));
  if (results.length > topN) results.length = topN;
}

export function searchMultiElementSetCoreEquipment({
  items = [],
  sets = [],
  constraints = {},
  fmPolicy = {},
  syntheticOffense = {},
  requiredItemIds = [],
  topN = 10,
  searchProfile = 'BALANCED',
  onProgress = null,
  onDiagnostics = null
} = {}) {
  const eligibleItems = filterOptimizerEligibleItems(items);
  const byId = new Map(eligibleItems.map((item) => [String(item.id), item]));
  const requiredIds = [...new Set((requiredItemIds || []).map(String).filter(Boolean))];
  const requiredItems = requiredIds.map((id) => byId.get(id)).filter(Boolean);
  if (requiredItems.length !== requiredIds.length) {
    return { applicable: true, results: [], diagnostics: { mode: 'multi-element-set-core-search-v1', reason: 'required-item-missing' } };
  }

  const capacities = slotCapacities();
  if (!withinSlotCaps(requiredItems, capacities)) {
    return { applicable: true, results: [], diagnostics: { mode: 'multi-element-set-core-search-v1', reason: 'required-item-shape' } };
  }

  const setsById = setsByIdFor(sets);
  const prefilter = buildEquipmentCandidatePools({
    items: eligibleItems,
    sets,
    constraints,
    fmPolicy,
    syntheticOffense,
    searchProfile,
    requiredItemIds: requiredIds
  });
  const policy = prefilter.policy;
  const scoreStats = (stats) => policy.rankStats(stats);
  const scoreItems = (selected) => scoreStats(equipmentStats(selected, setsById));

  const requiredEquipment = requiredItems.filter((item) => item.slot !== 'dofus' && item.slot !== 'companion');
  const requiredCompanions = requiredItems.filter((item) => item.slot === 'companion');
  const requiredDofus = requiredItems.filter((item) => item.slot === 'dofus');
  if (requiredCompanions.length > 1 || requiredDofus.length > 6) {
    return { applicable: true, results: [], diagnostics: { mode: 'multi-element-set-core-search-v1', reason: 'required-special-shape' } };
  }

  function stateFor(selected, extra = {}) {
    const ranked = scoreItems(selected);
    return {
      items: selected,
      score: Number(ranked.rankScore || 0),
      offense: ranked.syntheticOffense,
      ...extra
    };
  }

  function resourceBucket(state) {
    const stats = contextualStats(state.items, setsById, fmPolicy);
    const apTarget = Math.max(1, Number(constraints?.ap || 12));
    const mpTarget = Math.max(1, Number(constraints?.mp || 6));
    return `${Math.min(apTarget, effectiveStat(stats, 'ap'))}:${Math.min(mpTarget, effectiveStat(stats, 'mp'))}`;
  }

  function keepStates(states, limit, perBucket = 6) {
    const dedup = new Map();
    for (const state of states || []) {
      const key = itemKey(state.items);
      const previous = dedup.get(key);
      if (!previous || Number(state.score || 0) > Number(previous.score || 0)) dedup.set(key, state);
    }
    const ranked = [...dedup.values()].sort((a, b) => Number(b.score || 0) - Number(a.score || 0)
      || itemKey(a.items).localeCompare(itemKey(b.items)));
    const output = [];
    const seen = new Set();
    const buckets = new Map();
    const push = (state, enforceBucket) => {
      if (!state || output.length >= limit) return;
      const key = itemKey(state.items);
      if (seen.has(key)) return;
      const bucket = resourceBucket(state);
      const used = Number(buckets.get(bucket) || 0);
      if (enforceBucket && used >= perBucket) return;
      seen.add(key);
      buckets.set(bucket, used + 1);
      output.push(state);
    };
    for (const state of ranked) push(state, true);
    for (const state of ranked) push(state, false);
    return output;
  }

  const catalog = buildSetCoreCatalog({
    items: eligibleItems,
    sets,
    pieceCounts: [2, 3, 4],
    minLevel: 190,
    maxLevel: 200,
    profileItem: (item) => policy.profileItem(item)
  });

  const rankedCores = (catalog.cores || [])
    .filter((core) => core?.legality?.valid)
    .map((core) => {
      const ranked = scoreStats(core.searchStats || core.aggregateStats || {});
      return {
        ...core,
        combinedScore: Number(ranked.rankScore || 0),
        combinedMinimum: Number(ranked.syntheticOffense?.minimumScore || 0),
        ap: Number(core?.setBonuses?.ap || 0) + Number(core?.aggregateStats?.ap || 0),
        mp: Number(core?.setBonuses?.mp || 0) + Number(core?.aggregateStats?.mp || 0)
      };
    });

  function corePool(pieceCount) {
    const pool = rankedCores.filter((core) => Number(core.pieceCount) === Number(pieceCount));
    const selected = new Map();
    const add = (rows, count) => {
      for (const core of rows.slice(0, count)) selected.set(core.id, core);
    };
    const limit = Number(CORE_POOL_LIMIT[pieceCount] || 30);
    add([...pool].sort((a, b) => b.combinedScore - a.combinedScore || String(a.id).localeCompare(String(b.id))), limit);
    add([...pool].sort((a, b) => b.ap - a.ap || b.combinedScore - a.combinedScore), 12);
    add([...pool].sort((a, b) => b.mp - a.mp || b.combinedScore - a.combinedScore), 12);
    return [...selected.values()]
      .sort((a, b) => b.combinedScore - a.combinedScore || String(a.id).localeCompare(String(b.id)))
      .slice(0, limit);
  }

  const coresByCount = new Map([[2, corePool(2)], [3, corePool(3)], [4, corePool(4)]]);

  function coreCompatible(state, core) {
    if (state.setIds?.has(String(core.setId))) return false;
    const used = new Set((state.items || []).map((item) => String(item.id)));
    if ((core.items || []).some((item) => used.has(String(item.id)))) return false;
    return withinSlotCaps([...(state.items || []), ...(core.items || [])], capacities);
  }

  function expandPattern(pattern) {
    let states = [stateFor(requiredEquipment, { setIds: new Set() })];
    for (const pieceCount of pattern) {
      const expanded = [];
      for (const state of states) {
        for (const core of coresByCount.get(pieceCount) || []) {
          if (!coreCompatible(state, core)) continue;
          expanded.push(stateFor([...state.items, ...core.items], {
            setIds: new Set([...(state.setIds || []), String(core.setId)])
          }));
        }
      }
      states = keepStates(expanded, CORE_BEAM_LIMIT, 8);
      if (!states.length) break;
    }
    return keepStates(states, PER_PATTERN_LIMIT, 6);
  }

  const architectureStates = keepStates(CORE_PATTERNS.flatMap(expandPattern), CORE_BEAM_LIMIT, 8);

  function missingEquipmentSlots(selected) {
    const counts = slotCounts(selected);
    const missing = [];
    for (const rule of SLOT_RULES) {
      if (rule.id === 'dofus' || rule.id === 'companion') continue;
      const have = Number(counts.get(rule.id) || 0);
      for (let index = have; index < Number(rule.count || 0); index++) missing.push(rule.id);
    }
    return missing.sort((a, b) => Number(prefilter.pools?.[a]?.length || 0) - Number(prefilter.pools?.[b]?.length || 0));
  }

  function completionPool(slot) {
    const rows = (prefilter.pools?.[slot] || []).map((item) => ({ item, ranked: policy.profileItem(item) }));
    const selected = new Map();
    const add = (list, count) => {
      for (const row of list.slice(0, count)) selected.set(String(row.item.id), row.item);
    };
    add([...rows].sort((a, b) => Number(b.ranked.rankScore || 0) - Number(a.ranked.rankScore || 0)), 14);
    add([...rows].sort((a, b) => effectiveStat(b.item.stats || {}, 'ap') - effectiveStat(a.item.stats || {}, 'ap')
      || Number(b.ranked.rankScore || 0) - Number(a.ranked.rankScore || 0)), 5);
    add([...rows].sort((a, b) => effectiveStat(b.item.stats || {}, 'mp') - effectiveStat(a.item.stats || {}, 'mp')
      || Number(b.ranked.rankScore || 0) - Number(a.ranked.rankScore || 0)), 5);
    return [...selected.values()];
  }

  const equipmentPools = Object.fromEntries(SLOT_RULES
    .filter((rule) => rule.id !== 'dofus' && rule.id !== 'companion')
    .map((rule) => [rule.id, completionPool(rule.id)]));

  const equipmentCompleted = [];
  for (const architecture of architectureStates) {
    let states = [architecture];
    for (const slot of missingEquipmentSlots(architecture.items)) {
      const expanded = [];
      for (const state of states) {
        const used = new Set(state.items.map((item) => String(item.id)));
        for (const item of equipmentPools[slot] || []) {
          if (used.has(String(item.id))) continue;
          const next = [...state.items, item];
          if (!withinSlotCaps(next, capacities)) continue;
          expanded.push(stateFor(next, { setIds: state.setIds }));
        }
      }
      states = keepStates(expanded, SLOT_BEAM_LIMIT, 6);
      if (!states.length) break;
    }
    for (const state of states) {
      const counts = slotCounts(state.items);
      const complete = SLOT_RULES
        .filter((rule) => rule.id !== 'dofus' && rule.id !== 'companion')
        .every((rule) => Number(counts.get(rule.id) || 0) === Number(rule.count || 0));
      if (complete) equipmentCompleted.push(state);
    }
  }

  const equipmentStates = keepStates(equipmentCompleted, EQUIPMENT_LIMIT, 8);
  const companionPool = requiredCompanions.length
    ? requiredCompanions
    : (prefilter.pools?.companion || [])
      .map((item) => ({ item, score: Number(policy.profileItem(item).rankScore || 0) }))
      .sort((a, b) => b.score - a.score || String(a.item.id).localeCompare(String(b.item.id)))
      .slice(0, 12)
      .map((entry) => entry.item);

  const contextRaw = [];
  for (const state of equipmentStates) {
    for (const companion of companionPool) {
      const next = [...state.items, companion];
      if (!withinSlotCaps(next, capacities)) continue;
      contextRaw.push(stateFor(next));
    }
  }
  const contexts = keepStates(contextRaw, CONTEXT_LIMIT, 6);

  const allDofusRows = (prefilter.pools?.dofus || []).map((item) => ({
    item,
    score: Number(policy.profileItem(item).rankScore || 0)
  }));
  const byName = new Map(allDofusRows.map((row) => [String(row.item.name), row]));
  const canonicalNames = [
    'Dofus Pourpre', 'Dofus des Glaces', 'Dofus Turquoise', 'Dofus Ocre',
    'Dofus Vulbis', 'Vulbis', 'Dolmanax', 'Robuste majeur'
  ];

  function branchDofusPool(branch) {
    const selected = new Map();
    const add = (row) => {
      if (!row || !branchAllows(row.item, branch)) return;
      selected.set(String(row.item.id), row);
    };
    for (const name of canonicalNames) add(byName.get(name));
    for (const row of [...allDofusRows]
      .filter((entry) => branchAllows(entry.item, branch))
      .sort((a, b) => b.score - a.score || String(a.item.id).localeCompare(String(b.item.id)))
      .slice(0, DOFUS_POOL_LIMIT)) add(row);
    for (const key of positiveEquipmentConstraintKeys(constraints)) {
      const helpers = [...allDofusRows]
        .filter((entry) => branchAllows(entry.item, branch))
        .filter((entry) => effectiveStat(entry.item.stats || {}, key) > 0)
        .sort((a, b) => effectiveStat(b.item.stats || {}, key) - effectiveStat(a.item.stats || {}, key)
          || b.score - a.score)
        .slice(0, 2);
      for (const row of helpers) add(row);
    }
    return [...selected.values()]
      .sort((a, b) => b.score - a.score || String(a.item.id).localeCompare(String(b.item.id)))
      .slice(0, DOFUS_POOL_LIMIT)
      .map((row) => row.item);
  }

  const critMode = String(syntheticOffense?.critMode || 'auto').toLowerCase();
  const results = [];
  const rejected = {};
  let combinationsConsidered = 0;
  let evaluated = 0;
  let valid = 0;

  for (const context of contexts) {
    for (const branch of branchesForCritMode(critMode)) {
      if (requiredDofus.some((item) => !branchAllows(item, branch))) continue;
      const requiredDofusIds = new Set(requiredDofus.map((item) => String(item.id)));
      const available = branchDofusPool(branch).filter((item) => !requiredDofusIds.has(String(item.id)));
      const missing = 6 - requiredDofus.length;
      if (missing < 0 || available.length < missing) continue;
      const turquoiseRequired = branch === 'CRIT';
      const candidates = [];

      for (const chosen of choose(available, missing)) {
        combinationsConsidered++;
        const dofus = [...requiredDofus, ...chosen];
        if (!specialSlotRulesAreValid(dofus)) continue;
        if (turquoiseRequired && !dofus.some((item) => String(item.name) === 'Dofus Turquoise')) continue;
        const selected = [...context.items, ...dofus];
        const stats = contextualStats(selected, setsById, fmPolicy);
        const apTarget = Number(constraints?.ap || 0);
        const mpTarget = Number(constraints?.mp || 0);
        const rangeTarget = Number(constraints?.range || 0);
        if (apTarget > 0 && effectiveStat(stats, 'ap') < apTarget) continue;
        if (mpTarget > 0 && effectiveStat(stats, 'mp') < mpTarget) continue;
        if (rangeTarget > 0 && effectiveStat(stats, 'range') < rangeTarget) continue;
        candidates.push(stateFor(selected, { branch }));
      }

      const completions = keepStates(candidates, DOFUS_COMPLETION_LIMIT, DOFUS_COMPLETION_LIMIT);
      for (const completion of completions) {
        const evaluation = evaluateCompleteEquipmentBuild({
          items: completion.items,
          sets,
          constraints,
          fmPolicy,
          syntheticOffense
        });
        evaluated++;
        if (!evaluation.result) {
          const reason = evaluation.reason || 'unknown';
          rejected[reason] = Number(rejected[reason] || 0) + 1;
          continue;
        }
        valid++;
        insertResult(results, {
          ...evaluation.result,
          searchArchitecture: {
            pattern: 'combined-set-core',
            branch,
            combinedObjective: true,
            setBonusBeforeRanking: true
          }
        }, Math.max(1, Number(topN || 10)));
      }
    }
  }

  const diagnostics = {
    mode: 'multi-element-set-core-search-v1',
    applicable: true,
    primary: true,
    requestedElements: [...(policy.elements || [])],
    setBonusBeforeRanking: true,
    setCoresConsidered: rankedCores.length,
    core2Pool: Number(coresByCount.get(2)?.length || 0),
    core3Pool: Number(coresByCount.get(3)?.length || 0),
    core4Pool: Number(coresByCount.get(4)?.length || 0),
    architecturesRetained: architectureStates.length,
    equipmentStatesRetained: equipmentStates.length,
    contextsRetained: contexts.length,
    dofusCombinationsConsidered: combinationsConsidered,
    evaluated,
    authoritativeEvaluated: evaluated,
    valid,
    rejected,
    fallbackRequired: results.length === 0
  };

  if (typeof onProgress === 'function') {
    onProgress({
      phase: 'multi-element-set-core-search',
      label: results.length ? 'complete' : 'empty',
      nodes: combinationsConsidered,
      visited: evaluated,
      pruned: 0,
      best: results[0]?.syntheticOffense?.minimumScore || 0
    });
  }
  if (typeof onDiagnostics === 'function') onDiagnostics({ trace: [{ ...diagnostics }] });

  return {
    applicable: true,
    results,
    candidateItems: prefilter.items,
    candidatePools: prefilter.pools,
    diagnostics
  };
}
