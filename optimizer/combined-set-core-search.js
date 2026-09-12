import { BASE_CHARACTER, SLOT_RULES } from '../js/config.js';
import { addStats, effectiveStat, emptyStats } from '../js/stats.js';
import { applySetBonuses } from '../js/sets.js';
import {
  MAX_PERMANENT_AP,
  MAX_PERMANENT_MP,
  specialSlotRulesAreValid
} from '../js/build-legality.js';
import { statsWithStructuralExos } from '../js/structural-exos.js';
import {
  compareCompleteEquipmentBuildResults,
  evaluateCompleteEquipmentBuild
} from '../js/complete-equipment-build-evaluator.js';
import { buildEquipmentCandidatePools } from './equipment-candidate-policy.js';
import { filterOptimizerEligibleItems } from './item-eligibility.js';

const ELEMENTS = Object.freeze(['earth', 'fire', 'water', 'air']);
const ELEMENT_DAMAGE = Object.freeze({ earth: 'damageEarth', fire: 'damageFire', water: 'damageWater', air: 'damageAir' });
const EQUIPMENT_RULES = SLOT_RULES.filter((rule) => !['companion', 'dofus'].includes(rule.id));
const EQUIPMENT_CAPS = new Map(EQUIPMENT_RULES.map((rule) => [rule.id, Number(rule.count || 0)]));
const CORE_PATTERNS = Object.freeze([
  [4, 3, 2], [4, 3], [4, 2, 2], [4, 2], [4],
  [3, 3, 3], [3, 3, 2], [3, 2, 2, 2], [3, 2, 2], [3, 3], [3, 2], [3],
  [2, 2, 2, 2], [2, 2, 2], [2, 2], [2]
]);

function unique(values = []) {
  return [...new Set((values || []).map((value) => String(value || '').trim().toLowerCase()).filter(Boolean))];
}

function requestedAxes(syntheticOffense = {}) {
  const raw = unique(syntheticOffense?.elements);
  if (raw.includes('multi')) return [...ELEMENTS];
  return raw.filter((element) => ELEMENTS.includes(element));
}

export function combinedSetCoreApplicable(syntheticOffense = {}) {
  const raw = unique(syntheticOffense?.elements);
  return raw.includes('multi') || requestedAxes(syntheticOffense).length > 1;
}

function itemKey(items = []) {
  return (items || []).map((item) => String(item?.id ?? '')).sort().join('|');
}

function setsByIdFor(sets = []) {
  return Object.fromEntries((sets || []).map((set) => [set.id, set]));
}

function itemStats(items = [], setsById = {}) {
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

function positiveConstraintKeys(constraints = {}) {
  return Object.entries(constraints || {})
    .filter(([, minimum]) => Number.isFinite(Number(minimum)) && Number(minimum) > 0)
    .map(([key]) => key);
}

export function combinedOffenseSearchScore(policy, stats = {}) {
  const ranked = policy.rankStats(stats);
  return {
    score: Number(ranked.objectiveGain || 0),
    meanScore: Number(ranked.meanGain || 0),
    completionScore: Number(ranked.rankScore || 0),
    constraintSignal: Number(ranked.constraintSignal || 0),
    offense: ranked.syntheticOffense
  };
}

function stateScore(items, policy, setsById) {
  const stats = itemStats(items, setsById);
  const ranked = combinedOffenseSearchScore(policy, stats);
  return { stats, ...ranked };
}

function compareStatePriority(left, right) {
  return Number(right?.score || 0) - Number(left?.score || 0)
    || Number(right?.meanScore || 0) - Number(left?.meanScore || 0)
    || itemKey(left?.items || []).localeCompare(itemKey(right?.items || []));
}

function setSignature(items = []) {
  const counts = new Map();
  for (const item of items) if (item?.setId) counts.set(String(item.setId), Number(counts.get(String(item.setId)) || 0) + 1);
  return [...counts.entries()]
    .filter(([, count]) => count >= 2)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, count]) => `${id}:${count}`)
    .join(',');
}

function resourceBucket(items, setsById, fmPolicy, constraints) {
  const stats = contextualStats(items, setsById, fmPolicy);
  const apTarget = Math.max(1, Number(constraints?.ap || 12));
  const mpTarget = Math.max(1, Number(constraints?.mp || 6));
  return `${Math.min(apTarget, effectiveStat(stats, 'ap'))}:${Math.min(mpTarget, effectiveStat(stats, 'mp'))}:${setSignature(items)}`;
}

function specialistKeys(axes = []) {
  return [...new Set([
    ...axes.flatMap((element) => [element, ELEMENT_DAMAGE[element]]),
    'power', 'damage', 'spellDamagePct', 'crit', 'critDamage', 'ap', 'mp', 'range'
  ])];
}

function retainStates(states, limit, context) {
  const dedup = new Map();
  for (const state of states || []) {
    const key = itemKey(state.items);
    if (!key) continue;
    const previous = dedup.get(key);
    if (!previous || compareStatePriority(state, previous) < 0) dedup.set(key, state);
  }
  const ranked = [...dedup.values()].sort(compareStatePriority);
  if (ranked.length <= limit) return ranked;

  const output = [];
  const seen = new Set();
  const perBucket = new Map();
  const add = (state, enforceBucket = false) => {
    if (!state || output.length >= limit) return;
    const key = itemKey(state.items);
    if (seen.has(key)) return;
    const bucket = resourceBucket(state.items, context.setsById, context.fmPolicy, context.constraints);
    const used = Number(perBucket.get(bucket) || 0);
    if (enforceBucket && used >= 4) return;
    seen.add(key);
    perBucket.set(bucket, used + 1);
    output.push(state);
  };

  for (const statKey of context.specialistKeys || []) {
    const specialists = [...ranked]
      .filter((state) => effectiveStat(state.stats || itemStats(state.items, context.setsById), statKey) > 0)
      .sort((a, b) => effectiveStat(b.stats || itemStats(b.items, context.setsById), statKey)
        - effectiveStat(a.stats || itemStats(a.items, context.setsById), statKey)
        || compareStatePriority(a, b))
      .slice(0, 3);
    for (const state of specialists) add(state);
  }
  for (const state of ranked) add(state, true);
  for (const state of ranked) add(state, false);
  return output;
}

function structuralProgress(state, context) {
  const stats = contextualStats(state?.items || [], context.setsById, context.fmPolicy);
  const apTarget = Math.max(1, Number(context.constraints?.ap || 12));
  const mpTarget = Math.max(1, Number(context.constraints?.mp || 6));
  const ap = Math.min(apTarget, effectiveStat(stats, 'ap')) / apTarget;
  const mp = Math.min(mpTarget, effectiveStat(stats, 'mp')) / mpTarget;
  return ap + mp;
}

function terminalSetKey(state) {
  const core = state?.cores?.[state.cores.length - 1];
  return core?.setId == null ? '' : String(core.setId);
}

export function retainCombinedArchitectureStates(states, limit, context) {
  const dedup = new Map();
  for (const state of states || []) {
    const key = itemKey(state.items);
    if (!key) continue;
    const previous = dedup.get(key);
    if (!previous || compareStatePriority(state, previous) < 0) dedup.set(key, state);
  }
  const ranked = [...dedup.values()].sort(compareStatePriority);
  if (ranked.length <= limit) return ranked;

  const output = [];
  const seen = new Set();
  const add = (state) => {
    if (!state || output.length >= limit) return;
    const key = itemKey(state.items);
    if (seen.has(key)) return;
    seen.add(key);
    output.push(state);
  };
  const take = (values, amount) => {
    let added = 0;
    for (const value of values) {
      if (output.length >= limit || added >= amount) break;
      const before = output.length;
      add(value);
      if (output.length > before) added++;
    }
  };

  // Balanced combined offense remains the primary lane.
  take(ranked, Math.max(12, Math.floor(limit * 0.18)));

  // Structural AP/MP closure is reserved independently instead of dominating offense.
  take([...ranked].sort((a, b) => structuralProgress(b, context) - structuralProgress(a, context)
    || compareStatePriority(a, b)), Math.max(10, Math.floor(limit * 0.10)));

  // rankScore is retained only as a bounded completion-potential lane.
  take([...ranked].sort((a, b) => Number(b?.completionScore || 0) - Number(a?.completionScore || 0)
    || compareStatePriority(a, b)), Math.max(10, Math.floor(limit * 0.10)));

  // Preserve the best lineage for many distinct terminal sets. This prevents a strong
  // late 2-piece/3-piece set completion from disappearing only because its partial
  // immediate offense is below another set family.
  const bestByTerminalSet = new Map();
  for (const state of ranked) {
    const key = terminalSetKey(state);
    if (key && !bestByTerminalSet.has(key)) bestByTerminalSet.set(key, state);
  }
  take([...bestByTerminalSet.values()].sort(compareStatePriority), Math.max(36, Math.floor(limit * 0.48)));

  // Requested-element/common-stat specialists keep a small independent lane.
  for (const statKey of context.specialistKeys || []) {
    const specialist = [...ranked]
      .filter((state) => effectiveStat(state.stats || itemStats(state.items, context.setsById), statKey) > 0)
      .sort((a, b) => effectiveStat(b.stats || itemStats(b.items, context.setsById), statKey)
        - effectiveStat(a.stats || itemStats(a.items, context.setsById), statKey)
        || compareStatePriority(a, b))[0];
    add(specialist);
  }

  // Reuse the general feasibility-aware reserve policy for any capacity left.
  for (const state of retainStates(ranked, limit, context)) add(state);
  for (const state of ranked) add(state);
  return output;
}

function equipmentShapeValid(items = []) {
  const counts = new Map();
  for (const item of items) {
    const count = Number(counts.get(item?.slot) || 0) + 1;
    if (count > Number(EQUIPMENT_CAPS.get(item?.slot) || 0)) return false;
    counts.set(item?.slot, count);
  }
  return specialSlotRulesAreValid(items);
}

function coresCompatible(cores = []) {
  const setIds = new Set();
  const itemIds = new Set();
  const items = [];
  for (const core of cores) {
    const setId = String(core.setId);
    if (setIds.has(setId)) return false;
    setIds.add(setId);
    for (const item of core.items || []) {
      const id = String(item.id);
      if (itemIds.has(id)) return false;
      itemIds.add(id);
      items.push(item);
    }
  }
  return equipmentShapeValid(items);
}

function boundedCorePools(policy, axes) {
  const keys = specialistKeys(axes);
  const rows = (policy.setCoreCatalog?.cores || [])
    .filter((core) => core?.legality?.valid)
    .map((core) => {
      const ranked = policy.rankStats(core.searchStats || core.aggregateStats || {});
      return {
        core,
        stats: core.searchStats || core.aggregateStats || {},
        score: Number(ranked.rankScore || 0),
        objective: Number(ranked.objectiveGain || 0)
      };
    });

  const byCount = new Map();
  for (const count of [2, 3, 4]) {
    const pool = rows.filter((row) => Number(row.core.pieceCount) === count);
    const selected = new Map();
    const add = (values, amount) => {
      for (const row of values.slice(0, amount)) selected.set(row.core.id, row);
    };
    add([...pool].sort((a, b) => b.score - a.score), 55);
    for (const key of keys) {
      add([...pool]
        .filter((row) => effectiveStat(row.stats, key) > 0)
        .sort((a, b) => effectiveStat(b.stats, key) - effectiveStat(a.stats, key) || b.score - a.score), 8);
    }
    const perSet = new Map();
    for (const row of [...pool].sort((a, b) => b.score - a.score)) {
      const setId = String(row.core.setId);
      const used = Number(perSet.get(setId) || 0);
      if (used >= 2) continue;
      perSet.set(setId, used + 1);
      selected.set(row.core.id, row);
    }
    byCount.set(count, [...selected.values()]
      .sort((a, b) => b.score - a.score || String(a.core.id).localeCompare(String(b.core.id)))
      .slice(0, 95)
      .map((row) => row.core));
  }
  return byCount;
}

function enumerateArchitectures(corePools, context) {
  const all = [];
  for (const pattern of CORE_PATTERNS) {
    let states = [{ cores: [], items: [], stats: {}, score: 0, meanScore: 0, completionScore: 0, pattern: pattern.join('+') }];
    for (const pieceCount of pattern) {
      const expanded = [];
      for (const state of states) {
        for (const core of corePools.get(pieceCount) || []) {
          const cores = [...state.cores, core];
          if (!coresCompatible(cores)) continue;
          const items = cores.flatMap((entry) => entry.items);
          const ranked = stateScore(items, context.policy, context.setsById);
          expanded.push({ cores, items, stats: ranked.stats, score: ranked.score, meanScore: ranked.meanScore,
            completionScore: ranked.completionScore, constraintSignal: ranked.constraintSignal, pattern: state.pattern });
        }
      }
      states = retainCombinedArchitectureStates(expanded, 120, context);
      if (!states.length) break;
    }
    all.push(...states);
  }
  return retainCombinedArchitectureStates(all, 180, context);
}

function slotPool(slot, eligibleItems, prefilter, context) {
  const candidates = new Map();
  const add = (item) => { if (item?.slot === slot) candidates.set(String(item.id), item); };
  for (const item of prefilter.pools?.[slot] || []) add(item);

  const rows = eligibleItems
    .filter((item) => item?.slot === slot)
    .map((item) => ({ item, profiled: context.policy.profileItem(item) }));
  const offenseRows = [...rows].sort((a, b) => Number(b.profiled.objectiveGain || 0) - Number(a.profiled.objectiveGain || 0)
    || Number(b.profiled.meanGain || 0) - Number(a.profiled.meanGain || 0)
    || String(a.item.id).localeCompare(String(b.item.id)));
  for (const row of offenseRows.slice(0, 18)) add(row.item);

  for (const key of [...new Set([...context.specialistKeys, ...positiveConstraintKeys(context.constraints)])]) {
    for (const row of [...rows]
      .filter((entry) => effectiveStat(entry.profiled.optimisticStats || {}, key) > 0)
      .sort((a, b) => effectiveStat(b.profiled.optimisticStats || {}, key) - effectiveStat(a.profiled.optimisticStats || {}, key)
        || Number(b.profiled.objectiveGain || 0) - Number(a.profiled.objectiveGain || 0)
        || Number(b.profiled.meanGain || 0) - Number(a.profiled.meanGain || 0))
      .slice(0, 4)) add(row.item);
  }

  const candidateRows = [...candidates.values()].map((item) => ({ item, profiled: context.policy.profileItem(item) }));
  const limit = slot === 'ring' ? 34 : 28;
  const selected = new Map();
  const reserveKeys = [...new Set(['ap', 'mp', ...positiveConstraintKeys(context.constraints)])];
  for (const key of reserveKeys) {
    for (const row of [...candidateRows]
      .filter((entry) => effectiveStat(entry.profiled.optimisticStats || {}, key) > 0)
      .sort((a, b) => effectiveStat(b.profiled.optimisticStats || {}, key) - effectiveStat(a.profiled.optimisticStats || {}, key)
        || Number(b.profiled.objectiveGain || 0) - Number(a.profiled.objectiveGain || 0)
        || Number(b.profiled.meanGain || 0) - Number(a.profiled.meanGain || 0))
      .slice(0, 2)) {
      if (selected.size >= limit) break;
      selected.set(String(row.item.id), row.item);
    }
  }
  for (const row of candidateRows.sort((a, b) => Number(b.profiled.objectiveGain || 0) - Number(a.profiled.objectiveGain || 0)
    || Number(b.profiled.meanGain || 0) - Number(a.profiled.meanGain || 0)
    || Number(b.profiled.rankScore || 0) - Number(a.profiled.rankScore || 0)
    || String(a.item.id).localeCompare(String(b.item.id)))) {
    if (selected.size >= limit) break;
    selected.set(String(row.item.id), row.item);
  }
  return [...selected.values()];
}

function firstMissingEquipmentSlot(items = []) {
  const counts = new Map();
  for (const item of items) counts.set(item?.slot, Number(counts.get(item?.slot) || 0) + 1);
  for (const rule of EQUIPMENT_RULES) {
    if (Number(counts.get(rule.id) || 0) < Number(rule.count || 0)) return rule.id;
  }
  return null;
}

function completeEquipment(architectures, slotPools, context) {
  let states = architectures;
  for (let round = 0; round < 9; round++) {
    const expanded = [];
    let incomplete = false;
    for (const state of states) {
      const slot = firstMissingEquipmentSlot(state.items);
      if (!slot) {
        expanded.push(state);
        continue;
      }
      incomplete = true;
      const used = new Set(state.items.map((item) => String(item.id)));
      for (const item of slotPools[slot] || []) {
        if (used.has(String(item.id))) continue;
        const items = [...state.items, item];
        if (!equipmentShapeValid(items)) continue;
        const ranked = stateScore(items, context.policy, context.setsById);
        expanded.push({ ...state, items, stats: ranked.stats, score: ranked.score, meanScore: ranked.meanScore,
          completionScore: ranked.completionScore, constraintSignal: ranked.constraintSignal });
      }
    }
    states = retainStates(expanded, 260, context);
    if (!incomplete) break;
  }
  return retainStates(states.filter((state) => !firstMissingEquipmentSlot(state.items)), 90, context);
}

function completeCompanion(equipmentStates, pool, context) {
  const rows = [];
  for (const state of equipmentStates) {
    for (const companion of pool) {
      const items = [...state.items, companion];
      if (!specialSlotRulesAreValid(items)) continue;
      const ranked = stateScore(items, context.policy, context.setsById);
      rows.push({ ...state, items, stats: ranked.stats, score: ranked.score, meanScore: ranked.meanScore,
        completionScore: ranked.completionScore, constraintSignal: ranked.constraintSignal });
    }
  }
  return retainStates(rows, 55, context);
}

function dofusAllowed(item, critMode) {
  const name = String(item?.name || '');
  if (critMode === 'crit' && /^Robuste(?: majeur)?$/i.test(name)) return false;
  if (critMode === 'no_crit' && /^Dofus Turquoise$/i.test(name)) return false;
  return true;
}

function dofusPool(eligibleItems, prefilter, context, critMode) {
  const all = eligibleItems.filter((item) => item?.slot === 'dofus' && dofusAllowed(item, critMode));
  const rows = all.map((item) => ({ item, profiled: context.policy.profileItem(item) }));
  const byName = new Map(all.map((item) => [String(item?.name || ''), item]));
  const limit = 20;
  const selected = new Map();
  const add = (item) => {
    if (!item || !dofusAllowed(item, critMode) || selected.size >= limit) return;
    selected.set(String(item.id), item);
  };

  const canonicalNames = [
    'Dofus Ocre', 'Dofus Vulbis', 'Vulbis', 'Dofus Pourpre', 'Dofus des Glaces',
    'Dofus Turquoise', 'Dolmanax', 'Robuste majeur', 'Turbulent'
  ];
  for (const name of canonicalNames) add(byName.get(name));

  for (const key of [...new Set([...context.specialistKeys, ...positiveConstraintKeys(context.constraints)])]) {
    if (key === 'ap' || key === 'mp') continue;
    const specialist = [...rows]
      .filter((entry) => effectiveStat(entry.profiled.optimisticStats || {}, key) > 0)
      .sort((a, b) => effectiveStat(b.profiled.optimisticStats || {}, key) - effectiveStat(a.profiled.optimisticStats || {}, key)
        || Number(b.profiled.objectiveGain || 0) - Number(a.profiled.objectiveGain || 0)
        || Number(b.profiled.meanGain || 0) - Number(a.profiled.meanGain || 0))[0];
    add(specialist?.item);
  }

  for (const row of rows.sort((a, b) => Number(b.profiled.objectiveGain || 0) - Number(a.profiled.objectiveGain || 0)
    || Number(b.profiled.meanGain || 0) - Number(a.profiled.meanGain || 0)
    || String(a.item.id).localeCompare(String(b.item.id)))) add(row.item);

  for (const item of prefilter.pools?.dofus || []) add(item);
  return [...selected.values()];
}

function resourcesMeet(items, context) {
  const stats = contextualStats(items, context.setsById, context.fmPolicy);
  return effectiveStat(stats, 'ap') >= Number(context.constraints?.ap || 0)
    && effectiveStat(stats, 'mp') >= Number(context.constraints?.mp || 0);
}

function resourcesWithinPermanentCaps(items, context) {
  const stats = contextualStats(items, context.setsById, context.fmPolicy);
  return effectiveStat(stats, 'ap') <= MAX_PERMANENT_AP
    && effectiveStat(stats, 'mp') <= MAX_PERMANENT_MP;
}

function dofusPackages(baseItems, pool, context) {
  let states = [{ items: [], next: 0, stats: {}, score: 0, meanScore: 0 }];
  for (let pick = 0; pick < 6; pick++) {
    const expanded = [];
    for (const state of states) {
      for (let index = state.next; index < pool.length; index++) {
        const selected = [...state.items, pool[index]];
        if (!specialSlotRulesAreValid(selected)) continue;
        const complete = [...baseItems, ...selected];
        if (pick === 5 && (!resourcesMeet(complete, context) || !resourcesWithinPermanentCaps(complete, context))) continue;
        const ranked = stateScore(complete, context.policy, context.setsById);
        expanded.push({ items: selected, next: index + 1, stats: ranked.stats, score: ranked.score, meanScore: ranked.meanScore,
          completionScore: ranked.completionScore, constraintSignal: ranked.constraintSignal });
      }
    }
    states = retainStates(expanded.map((state) => ({ ...state, items: state.items })), 90, {
      ...context,
      setsById: {},
      fmPolicy: {},
      constraints: {}
    });
    if (!states.length) break;
  }
  return states
    .filter((state) => state.items.length === 6
      && resourcesMeet([...baseItems, ...state.items], context)
      && resourcesWithinPermanentCaps([...baseItems, ...state.items], context))
    .sort(compareStatePriority)
    .slice(0, 14);
}

function insertResult(results, candidate, topN) {
  if (!candidate) return;
  const existing = results.findIndex((entry) => entry.buildIdentity === candidate.buildIdentity);
  if (existing >= 0) results.splice(existing, 1);
  results.push(candidate);
  results.sort((a, b) => -compareCompleteEquipmentBuildResults(a, b));
  if (results.length > topN) results.length = topN;
}

export function searchCombinedSetCoreEquipment({
  items = [], sets = [], constraints = {}, fmPolicy = {}, syntheticOffense = {}, topN = 10,
  searchProfile = 'BALANCED', onProgress = null, onDiagnostics = null
} = {}) {
  if (!combinedSetCoreApplicable(syntheticOffense)) return { applicable: false, results: [] };

  const axes = requestedAxes(syntheticOffense);
  const eligibleItems = filterOptimizerEligibleItems(items);
  const setsById = setsByIdFor(sets);
  const prefilter = buildEquipmentCandidatePools({ items: eligibleItems, sets, constraints, fmPolicy, syntheticOffense, searchProfile });
  const context = { axes, policy: prefilter.policy, setsById, fmPolicy, constraints, specialistKeys: specialistKeys(axes) };

  const corePools = boundedCorePools(prefilter.policy, axes);
  const architectures = enumerateArchitectures(corePools, context);
  const slotPools = Object.fromEntries(EQUIPMENT_RULES.map((rule) => [rule.id, slotPool(rule.id, eligibleItems, prefilter, context)]));
  const equipmentStates = completeEquipment(architectures, slotPools, context);

  const companionCandidates = slotPool('companion', eligibleItems, prefilter, context).slice(0, 20);
  const companionStates = completeCompanion(equipmentStates, companionCandidates, context);
  const critMode = String(syntheticOffense?.critMode || 'auto').toLowerCase();
  const dofusCandidates = dofusPool(eligibleItems, prefilter, context, critMode);

  const results = [];
  const rejected = {};
  let evaluated = 0;
  let contextsWithPackages = 0;
  for (const state of companionStates) {
    const packages = dofusPackages(state.items, dofusCandidates, context);
    if (packages.length) contextsWithPackages++;
    for (const pack of packages) {
      const evaluation = evaluateCompleteEquipmentBuild({ items: [...state.items, ...pack.items], sets, constraints, fmPolicy, syntheticOffense });
      evaluated++;
      if (!evaluation.result) {
        const reason = evaluation.reason || 'unknown';
        rejected[reason] = Number(rejected[reason] || 0) + 1;
        continue;
      }
      insertResult(results, {
        ...evaluation.result,
        searchArchitecture: { pattern: state.pattern, branch: critMode, combinedSetCore: true }
      }, Math.max(1, Number(topN || 10)));
    }
  }

  const diagnostics = {
    mode: 'combined-set-core-first-search-v1', applicable: true, nativeCombinedObjective: true,
    setBonusBeforeCoreRanking: true,
    resourceScoring: 'offense-first-with-feasibility-reserves',
    architectureRetention: 'balanced+structural+specialist+set-diversity+completion',
    dofusPoolPolicy: 'canonical-offense-resource-reserve',
    finalResourceCapsAppliedBeforeDofusBeamRetention: true,
    requestedAxes: axes,
    core2Pool: (corePools.get(2) || []).length,
    core3Pool: (corePools.get(3) || []).length,
    core4Pool: (corePools.get(4) || []).length,
    architecturesRetained: architectures.length,
    equipmentStatesRetained: equipmentStates.length,
    companionStatesRetained: companionStates.length,
    dofusCandidates: dofusCandidates.length,
    contextsWithPackages, evaluated, valid: results.length, rejected,
    fallbackRequired: results.length === 0
  };

  if (typeof onProgress === 'function') {
    onProgress({ phase: 'combined-set-core-search', label: results.length ? 'complete' : 'empty', nodes: architectures.length,
      visited: evaluated, pruned: 0, heuristicTrimmed: 0, best: results[0]?.syntheticOffense?.minimumScore || 0 });
  }
  if (typeof onDiagnostics === 'function') onDiagnostics({ trace: [{ ...diagnostics }] });
  return { applicable: true, results, candidateItems: prefilter.items, candidatePools: prefilter.pools, diagnostics };
}
