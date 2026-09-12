import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { BASE_CHARACTER, SLOT_RULES } from '../js/config.js';
import { validateDofusSnapshot } from '../js/data-loader.js';
import { addStats, effectiveStat, emptyStats } from '../js/stats.js';
import { applySetBonuses } from '../js/sets.js';
import { specialSlotRulesAreValid } from '../js/build-legality.js';
import { statsWithStructuralExos } from '../js/structural-exos.js';
import { buildEquipmentCandidatePools } from '../optimizer/equipment-candidate-policy.js';
import {
  combinedOffenseSearchScore,
  retainCombinedArchitectureStates
} from '../optimizer/combined-set-core-search.js';

const raw = JSON.parse(readFileSync(new URL('../data/normalized/dofus-data.json', import.meta.url), 'utf8'));
const dataset = validateDofusSnapshot(raw);
const constraints = { ap: 12, mp: 6 };
const fmPolicy = { enabled: true, fmEnabled: true, exoAp: 1, exoMp: 1 };
const syntheticOffense = { elements: ['fire', 'water'], profiles: ['large'], critMode: 'auto' };
const axes = ['fire', 'water'];
const elementDamage = { earth: 'damageEarth', fire: 'damageFire', water: 'damageWater', air: 'damageAir' };
const equipmentRules = SLOT_RULES.filter((rule) => !['companion', 'dofus'].includes(rule.id));
const equipmentCaps = new Map(equipmentRules.map((rule) => [rule.id, Number(rule.count || 0)]));
const CORE_PATTERNS = [
  [4, 3, 2], [4, 3], [4, 2, 2], [4, 2], [4],
  [3, 3, 3], [3, 3, 2], [3, 2, 2, 2], [3, 2, 2], [3, 3], [3, 2], [3],
  [2, 2, 2, 2], [2, 2, 2], [2, 2], [2]
];

const witnessNames = [
  "Masque de l'Esprit Malsain", 'Cape Ovri', 'Talisman Songe', 'Boulon de Mekamouth',
  'Écrou de Mekamouth', 'Sangle Ouare', "Bottes de l'Esprit Malsain", 'Bêche de Mekamouth',
  'Quatre-feuilles', 'Kokulte', 'Impétueux', 'Arcaniste', 'Dofus des Glaces', 'Dofus Ocre',
  'Dofus Turquoise', 'Dofus Pourpre'
];
const normalize = (value = '') => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const witness = witnessNames.map((name) => {
  const matches = dataset.items.filter((item) => normalize(item.name) === normalize(name));
  assert.equal(matches.length, 1, `resolve ${name}`);
  return matches[0];
});
const witnessEquipment = witness.filter((item) => !['companion', 'dofus'].includes(item.slot));
const witnessEquipmentIds = new Set(witnessEquipment.map((item) => String(item.id)));
const witnessCompanion = witness.find((item) => item.slot === 'companion');

function itemKey(items = []) { return items.map((item) => String(item?.id ?? '')).sort().join('|'); }
function setsByIdFor(sets = []) { return Object.fromEntries(sets.map((set) => [set.id, set])); }
function itemStats(items = [], setsById = {}) {
  const stats = emptyStats();
  for (const item of items) addStats(stats, item?.stats || {});
  applySetBonuses(stats, items, setsById);
  return stats;
}
function contextualStats(items = [], setsById = {}) {
  const stats = emptyStats();
  addStats(stats, BASE_CHARACTER.baseStats || {});
  for (const item of items) addStats(stats, item?.stats || {});
  applySetBonuses(stats, items, setsById);
  return statsWithStructuralExos(stats, fmPolicy).stats;
}
function specialistKeys() {
  return [...new Set([...axes.flatMap((element) => [element, elementDamage[element]]), 'power', 'damage', 'spellDamagePct', 'crit', 'critDamage', 'ap', 'mp', 'range'])];
}
function positiveConstraintKeys() {
  return Object.entries(constraints).filter(([, value]) => Number(value) > 0).map(([key]) => key);
}
function setSignature(items = []) {
  const counts = new Map();
  for (const item of items) if (item?.setId) counts.set(String(item.setId), Number(counts.get(String(item.setId)) || 0) + 1);
  return [...counts.entries()].filter(([, count]) => count >= 2).sort(([a], [b]) => a.localeCompare(b)).map(([id, count]) => `${id}:${count}`).join(',');
}
function resourceBucket(items, setsById) {
  const stats = contextualStats(items, setsById);
  return `${Math.min(12, effectiveStat(stats, 'ap'))}:${Math.min(6, effectiveStat(stats, 'mp'))}:${setSignature(items)}`;
}
function compareStatePriority(left, right) {
  return Number(right?.score || 0) - Number(left?.score || 0)
    || Number(right?.meanScore || 0) - Number(left?.meanScore || 0)
    || itemKey(left?.items || []).localeCompare(itemKey(right?.items || []));
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
    const bucket = resourceBucket(state.items, context.setsById);
    const used = Number(perBucket.get(bucket) || 0);
    if (enforceBucket && used >= 4) return;
    seen.add(key); perBucket.set(bucket, used + 1); output.push(state);
  };
  for (const statKey of context.specialistKeys) {
    const specialists = [...ranked]
      .filter((state) => effectiveStat(state.stats || itemStats(state.items, context.setsById), statKey) > 0)
      .sort((a, b) => effectiveStat(b.stats || itemStats(b.items, context.setsById), statKey) - effectiveStat(a.stats || itemStats(a.items, context.setsById), statKey) || compareStatePriority(a, b))
      .slice(0, 3);
    for (const state of specialists) add(state);
  }
  for (const state of ranked) add(state, true);
  for (const state of ranked) add(state, false);
  return output;
}
function equipmentShapeValid(items = []) {
  const counts = new Map();
  for (const item of items) {
    const count = Number(counts.get(item?.slot) || 0) + 1;
    if (count > Number(equipmentCaps.get(item?.slot) || 0)) return false;
    counts.set(item?.slot, count);
  }
  return specialSlotRulesAreValid(items);
}
function coresCompatible(cores = []) {
  const setIds = new Set(); const itemIds = new Set(); const items = [];
  for (const core of cores) {
    const setId = String(core.setId);
    if (setIds.has(setId)) return false;
    setIds.add(setId);
    for (const item of core.items || []) {
      const id = String(item.id);
      if (itemIds.has(id)) return false;
      itemIds.add(id); items.push(item);
    }
  }
  return equipmentShapeValid(items);
}
function scoreState(items, policy, setsById) {
  const stats = itemStats(items, setsById);
  const ranked = combinedOffenseSearchScore(policy, stats);
  return { stats, score: ranked.score, meanScore: ranked.meanScore, completionScore: ranked.completionScore, constraintSignal: ranked.constraintSignal };
}
function boundedCorePools(policy) {
  const keys = specialistKeys();
  const rows = (policy.setCoreCatalog?.cores || []).filter((core) => core?.legality?.valid).map((core) => {
    const ranked = policy.rankStats(core.searchStats || core.aggregateStats || {});
    return { core, stats: core.searchStats || core.aggregateStats || {}, score: Number(ranked.rankScore || 0) };
  });
  const byCount = new Map();
  for (const count of [2, 3, 4]) {
    const pool = rows.filter((row) => Number(row.core.pieceCount) === count);
    const selected = new Map();
    const add = (values, amount) => { for (const row of values.slice(0, amount)) selected.set(row.core.id, row); };
    add([...pool].sort((a, b) => b.score - a.score), 55);
    for (const key of keys) add([...pool].filter((row) => effectiveStat(row.stats, key) > 0).sort((a, b) => effectiveStat(b.stats, key) - effectiveStat(a.stats, key) || b.score - a.score), 8);
    const perSet = new Map();
    for (const row of [...pool].sort((a, b) => b.score - a.score)) {
      const setId = String(row.core.setId); const used = Number(perSet.get(setId) || 0);
      if (used >= 2) continue;
      perSet.set(setId, used + 1); selected.set(row.core.id, row);
    }
    byCount.set(count, [...selected.values()].sort((a, b) => b.score - a.score || String(a.core.id).localeCompare(String(b.core.id))).slice(0, 95).map((row) => row.core));
  }
  return byCount;
}
function slotPool(slot, eligibleItems, prefilter, context) {
  const candidates = new Map();
  const add = (item) => { if (item?.slot === slot) candidates.set(String(item.id), item); };
  for (const item of prefilter.pools?.[slot] || []) add(item);
  const rows = eligibleItems.filter((item) => item?.slot === slot).map((item) => ({ item, profiled: context.policy.profileItem(item) }));
  for (const row of [...rows].sort((a, b) => Number(b.profiled.objectiveGain || 0) - Number(a.profiled.objectiveGain || 0) || Number(b.profiled.meanGain || 0) - Number(a.profiled.meanGain || 0)).slice(0, 18)) add(row.item);
  for (const key of [...new Set([...context.specialistKeys, ...positiveConstraintKeys()])]) {
    for (const row of [...rows].filter((entry) => effectiveStat(entry.profiled.optimisticStats || {}, key) > 0)
      .sort((a, b) => effectiveStat(b.profiled.optimisticStats || {}, key) - effectiveStat(a.profiled.optimisticStats || {}, key) || Number(b.profiled.objectiveGain || 0) - Number(a.profiled.objectiveGain || 0)).slice(0, 4)) add(row.item);
  }
  const candidateRows = [...candidates.values()].map((item) => ({ item, profiled: context.policy.profileItem(item) }));
  const limit = slot === 'ring' ? 34 : 28;
  const selected = new Map();
  for (const key of [...new Set(['ap', 'mp', ...positiveConstraintKeys()])]) {
    for (const row of [...candidateRows].filter((entry) => effectiveStat(entry.profiled.optimisticStats || {}, key) > 0)
      .sort((a, b) => effectiveStat(b.profiled.optimisticStats || {}, key) - effectiveStat(a.profiled.optimisticStats || {}, key) || Number(b.profiled.objectiveGain || 0) - Number(a.profiled.objectiveGain || 0)).slice(0, 2)) {
      if (selected.size >= limit) break;
      selected.set(String(row.item.id), row.item);
    }
  }
  for (const row of candidateRows.sort((a, b) => Number(b.profiled.objectiveGain || 0) - Number(a.profiled.objectiveGain || 0) || Number(b.profiled.meanGain || 0) - Number(a.profiled.meanGain || 0) || Number(b.profiled.rankScore || 0) - Number(a.profiled.rankScore || 0))) {
    if (selected.size >= limit) break;
    selected.set(String(row.item.id), row.item);
  }
  return [...selected.values()];
}
function firstMissingEquipmentSlot(items = []) {
  const counts = new Map();
  for (const item of items) counts.set(item?.slot, Number(counts.get(item?.slot) || 0) + 1);
  for (const rule of equipmentRules) if (Number(counts.get(rule.id) || 0) < Number(rule.count || 0)) return rule.id;
  return null;
}
function exactState(states, expectedItems) {
  const key = itemKey(expectedItems);
  return states.find((state) => itemKey(state.items) === key) || null;
}
function nextWitnessItem(items, slot) {
  const used = new Set(items.map((item) => String(item.id)));
  return witnessEquipment.find((item) => item.slot === slot && !used.has(String(item.id))) || null;
}

const prefilter = buildEquipmentCandidatePools({ items: dataset.items, sets: dataset.sets, constraints, fmPolicy, syntheticOffense, searchProfile: 'BALANCED' });
const policy = prefilter.policy;
const setsById = setsByIdFor(dataset.sets);
const context = { axes, policy, setsById, fmPolicy, constraints, specialistKeys: specialistKeys() };
const eligibleItems = dataset.items;
const witnessSetCounts = new Map();
for (const item of witnessEquipment) if (item.setId) witnessSetCounts.set(String(item.setId), Number(witnessSetCounts.get(String(item.setId)) || 0) + 1);
const exactWitnessCores = [...witnessSetCounts.entries()]
  .filter(([, pieceCount]) => pieceCount >= 2 && pieceCount <= 4)
  .map(([setId, pieceCount]) => policy.setCoreCatalog.cores.find((core) => String(core.setId) === setId && Number(core.pieceCount) === pieceCount && core.items.every((item) => witnessEquipmentIds.has(String(item.id)))))
  .filter(Boolean);
const witnessCoreItems = exactWitnessCores.flatMap((core) => core.items);
const targetPattern = exactWitnessCores.map((core) => Number(core.pieceCount)).sort((a, b) => b - a);
const corePools = boundedCorePools(policy);
const boundedPresence = exactWitnessCores.map((core) => ({ setName: core.setName, pieceCount: core.pieceCount, retained: (corePools.get(core.pieceCount) || []).some((candidate) => candidate.id === core.id) }));

let allArchitectures = [];
const targetRounds = [];
for (const pattern of CORE_PATTERNS) {
  let states = [{ cores: [], items: [], stats: {}, score: 0, meanScore: 0, completionScore: 0, constraintSignal: 0, pattern: pattern.join('+') }];
  let cumulative = [];
  for (const pieceCount of pattern) {
    const expanded = [];
    for (const state of states) {
      for (const core of corePools.get(pieceCount) || []) {
        const cores = [...state.cores, core];
        if (!coresCompatible(cores)) continue;
        const items = cores.flatMap((entry) => entry.items);
        expanded.push({ cores, items, ...scoreState(items, policy, setsById), pattern: state.pattern });
      }
    }
    if (pattern.join('+') === targetPattern.join('+')) {
      const expectedCore = exactWitnessCores.find((core) => Number(core.pieceCount) === pieceCount && !cumulative.includes(core.id));
      if (expectedCore) cumulative.push(expectedCore.id);
      const expectedItems = exactWitnessCores.filter((core) => cumulative.includes(core.id)).flatMap((core) => core.items);
      const before = exactState(expanded, expectedItems);
      const ranked = [...expanded].sort(compareStatePriority);
      const rawRank = before ? ranked.findIndex((state) => itemKey(state.items) === itemKey(expectedItems)) + 1 : null;
      states = retainCombinedArchitectureStates(expanded, 120, context);
      targetRounds.push({ pieceCount, expanded: expanded.length, expectedItems: expectedItems.map((item) => item.name), rawRank, witnessBefore: Boolean(before), witnessAfter: Boolean(exactState(states, expectedItems)), retained: states.length });
    } else {
      states = retainCombinedArchitectureStates(expanded, 120, context);
    }
    if (!states.length) break;
  }
  allArchitectures.push(...states);
}
const witnessArchitectureBeforeFinal = exactState(allArchitectures, witnessCoreItems);
allArchitectures = retainCombinedArchitectureStates(allArchitectures, 180, context);
const witnessArchitectureAfterFinal = exactState(allArchitectures, witnessCoreItems);

const slotPools = Object.fromEntries(equipmentRules.map((rule) => [rule.id, slotPool(rule.id, eligibleItems, prefilter, context)]));
const witnessPoolPresence = witnessEquipment.map((item) => ({ name: item.name, slot: item.slot, inPool: (slotPools[item.slot] || []).some((candidate) => String(candidate.id) === String(item.id)) }));
let states = allArchitectures;
let expectedItems = [...witnessCoreItems];
const completionRounds = [];
for (let round = 0; round < 9; round++) {
  const expanded = [];
  let incomplete = false;
  const expectedSlot = firstMissingEquipmentSlot(expectedItems);
  const expectedItem = expectedSlot ? nextWitnessItem(expectedItems, expectedSlot) : null;
  const nextExpected = expectedItem ? [...expectedItems, expectedItem] : expectedItems;
  for (const state of states) {
    const slot = firstMissingEquipmentSlot(state.items);
    if (!slot) { expanded.push(state); continue; }
    incomplete = true;
    const used = new Set(state.items.map((item) => String(item.id)));
    for (const item of slotPools[slot] || []) {
      if (used.has(String(item.id))) continue;
      const items = [...state.items, item];
      if (!equipmentShapeValid(items)) continue;
      expanded.push({ ...state, items, ...scoreState(items, policy, setsById) });
    }
  }
  const witnessBefore = exactState(expanded, nextExpected);
  states = retainStates(expanded, 260, context);
  const witnessAfter = exactState(states, nextExpected);
  completionRounds.push({ round, expectedSlot, expectedItem: expectedItem?.name || null, expanded: expanded.length, witnessBefore: Boolean(witnessBefore), witnessAfter: Boolean(witnessAfter), retained: states.length });
  expectedItems = nextExpected;
  if (!incomplete) break;
}
states = retainStates(states.filter((state) => !firstMissingEquipmentSlot(state.items)), 90, context);
const witnessEquipmentAfterFinal = exactState(states, witnessEquipment);
const companionPool = slotPool('companion', eligibleItems, prefilter, context).slice(0, 20);
const companionInPool = companionPool.some((item) => String(item.id) === String(witnessCompanion?.id));
const companionRows = [];
for (const state of states) for (const companion of companionPool) {
  const items = [...state.items, companion];
  if (!specialSlotRulesAreValid(items)) continue;
  companionRows.push({ ...state, items, ...scoreState(items, policy, setsById) });
}
const expectedWithCompanion = [...witnessEquipment, witnessCompanion];
const witnessCompanionBefore = exactState(companionRows, expectedWithCompanion);
const companionStates = retainStates(companionRows, 55, context);
const witnessCompanionAfter = exactState(companionStates, expectedWithCompanion);

console.log(`FW_LARGE_WITNESS_SET_COUNTS=${JSON.stringify([...witnessSetCounts.entries()])}`);
console.log(`FW_LARGE_TARGET_PATTERN=${targetPattern.join('+')}`);
console.log(`FW_LARGE_EXACT_CORES=${JSON.stringify(exactWitnessCores.map((core) => ({ setName: core.setName, pieceCount: core.pieceCount, items: core.items.map((item) => item.name) })) )}`);
console.log(`FW_LARGE_BOUNDED_CORE_PRESENCE=${JSON.stringify(boundedPresence)}`);
console.log(`FW_LARGE_ARCHITECTURE_ROUNDS=${JSON.stringify(targetRounds)}`);
console.log(`FW_LARGE_ARCHITECTURE_FINAL=${JSON.stringify({ beforeFinal: Boolean(witnessArchitectureBeforeFinal), afterFinal: Boolean(witnessArchitectureAfterFinal), total: allArchitectures.length })}`);
console.log(`FW_LARGE_SLOT_POOL_PRESENCE=${JSON.stringify(witnessPoolPresence)}`);
console.log(`FW_LARGE_COMPLETION_ROUNDS=${JSON.stringify(completionRounds)}`);
console.log(`FW_LARGE_EQUIPMENT_FINAL=${witnessEquipmentAfterFinal ? 'PRESENT' : 'LOST'}`);
console.log(`FW_LARGE_COMPANION=${JSON.stringify({ inPool: companionInPool, beforeRetention: Boolean(witnessCompanionBefore), afterRetention: Boolean(witnessCompanionAfter), retained: companionStates.length })}`);
