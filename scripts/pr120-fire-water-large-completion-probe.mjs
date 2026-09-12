import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { BASE_CHARACTER, SLOT_RULES } from '../js/config.js';
import { validateDofusSnapshot } from '../js/data-loader.js';
import { addStats, effectiveStat, emptyStats } from '../js/stats.js';
import { applySetBonuses } from '../js/sets.js';
import { specialSlotRulesAreValid } from '../js/build-legality.js';
import { statsWithStructuralExos } from '../js/structural-exos.js';
import { buildEquipmentCandidatePools } from '../optimizer/equipment-candidate-policy.js';
import { filterOptimizerEligibleItems } from '../optimizer/item-eligibility.js';
import {
  boundedCorePools,
  combinedOffenseSearchScore,
  retainCombinedArchitectureStates,
  retainFinalArchitectureCandidates
} from '../optimizer/combined-set-core-search.js';

const raw = JSON.parse(readFileSync(new URL('../data/normalized/dofus-data.json', import.meta.url), 'utf8'));
const dataset = validateDofusSnapshot(raw);
const constraints = { ap: 12, mp: 6 };
const fmPolicy = { enabled: true, fmEnabled: true, exoAp: 1, exoMp: 1 };
const syntheticOffense = { elements: ['fire', 'water'], profiles: ['large'], critMode: 'auto' };
const axes = ['fire', 'water'];
const specialistKeys = ['fire', 'damageFire', 'water', 'damageWater', 'power', 'damage', 'spellDamagePct', 'crit', 'critDamage', 'ap', 'mp', 'range'];
const equipmentRules = SLOT_RULES.filter((rule) => !['companion', 'dofus'].includes(rule.id));
const equipmentCaps = new Map(equipmentRules.map((rule) => [rule.id, Number(rule.count || 0)]));
const CORE_PATTERNS = [
  [4, 3, 2], [4, 3], [4, 2, 2], [4, 2], [4],
  [3, 3, 3], [3, 3, 2], [3, 2, 2, 2], [3, 2, 2], [3, 3], [3, 2], [3],
  [2, 2, 2, 2], [2, 2, 2], [2, 2], [2]
];

const normalize = (value = '') => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const equipmentNames = [
  "Masque de l'Esprit Malsain", 'Cape Ovri', 'Talisman Songe', 'Boulon de Mekamouth',
  'Écrou de Mekamouth', 'Sangle Ouare', "Bottes de l'Esprit Malsain", 'Bêche de Mekamouth',
  'Quatre-feuilles'
];
const witnessEquipment = equipmentNames.map((name) => {
  const matches = dataset.items.filter((item) => normalize(item?.name) === normalize(name));
  assert.equal(matches.length, 1, `resolve ${name}`);
  return matches[0];
});
const witnessCoreItems = witnessEquipment.filter((item) => item.slot !== 'shield');
const witnessCoreIds = new Set(witnessCoreItems.map((item) => String(item.id)));
const witnessEquipmentKey = itemKey(witnessEquipment);
const quatreFeuilles = witnessEquipment.find((item) => item.slot === 'shield');

function itemKey(items = []) {
  return items.map((item) => String(item?.id ?? '')).sort().join('|');
}
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
function scoreState(items, policy, setsById) {
  const stats = itemStats(items, setsById);
  const ranked = combinedOffenseSearchScore(policy, stats);
  return { stats, score: ranked.score, meanScore: ranked.meanScore, completionScore: ranked.completionScore, constraintSignal: ranked.constraintSignal };
}
function comparePriority(a, b) {
  return Number(b?.score || 0) - Number(a?.score || 0)
    || Number(b?.meanScore || 0) - Number(a?.meanScore || 0)
    || itemKey(a?.items || []).localeCompare(itemKey(b?.items || []));
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
function positiveConstraintKeys() {
  return Object.entries(constraints).filter(([, minimum]) => Number(minimum) > 0).map(([key]) => key);
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
function retainStates(states, limit, context) {
  const dedup = new Map();
  for (const state of states || []) {
    const key = itemKey(state.items);
    if (!key) continue;
    const previous = dedup.get(key);
    if (!previous || comparePriority(state, previous) < 0) dedup.set(key, state);
  }
  const ranked = [...dedup.values()].sort(comparePriority);
  if (ranked.length <= limit) return ranked;
  const output = []; const seen = new Set(); const perBucket = new Map();
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
      .sort((a, b) => effectiveStat(b.stats || itemStats(b.items, context.setsById), statKey) - effectiveStat(a.stats || itemStats(a.items, context.setsById), statKey) || comparePriority(a, b))
      .slice(0, 3);
    for (const state of specialists) add(state);
  }
  for (const state of ranked) add(state, true);
  for (const state of ranked) add(state, false);
  return output;
}
function slotPool(slot, eligibleItems, prefilter, context) {
  const candidates = new Map();
  const add = (item) => { if (item?.slot === slot) candidates.set(String(item.id), item); };
  for (const item of prefilter.pools?.[slot] || []) add(item);
  const rows = eligibleItems.filter((item) => item?.slot === slot).map((item) => ({ item, profiled: context.policy.profileItem(item) }));
  const offenseRows = [...rows].sort((a, b) => Number(b.profiled.objectiveGain || 0) - Number(a.profiled.objectiveGain || 0)
    || Number(b.profiled.meanGain || 0) - Number(a.profiled.meanGain || 0)
    || String(a.item.id).localeCompare(String(b.item.id)));
  for (const row of offenseRows.slice(0, 18)) add(row.item);
  for (const key of [...new Set([...context.specialistKeys, ...positiveConstraintKeys()])]) {
    for (const row of [...rows].filter((entry) => effectiveStat(entry.profiled.optimisticStats || {}, key) > 0)
      .sort((a, b) => effectiveStat(b.profiled.optimisticStats || {}, key) - effectiveStat(a.profiled.optimisticStats || {}, key)
        || Number(b.profiled.objectiveGain || 0) - Number(a.profiled.objectiveGain || 0)
        || Number(b.profiled.meanGain || 0) - Number(a.profiled.meanGain || 0)).slice(0, 4)) add(row.item);
  }
  const candidateRows = [...candidates.values()].map((item) => ({ item, profiled: context.policy.profileItem(item) }));
  const limit = slot === 'ring' ? 34 : 28;
  const selected = new Map();
  for (const key of [...new Set(['ap', 'mp', ...positiveConstraintKeys()])]) {
    for (const row of [...candidateRows].filter((entry) => effectiveStat(entry.profiled.optimisticStats || {}, key) > 0)
      .sort((a, b) => effectiveStat(b.profiled.optimisticStats || {}, key) - effectiveStat(a.profiled.optimisticStats || {}, key)
        || Number(b.profiled.objectiveGain || 0) - Number(a.profiled.objectiveGain || 0)
        || Number(b.profiled.meanGain || 0) - Number(a.profiled.meanGain || 0)).slice(0, 2)) {
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
  for (const rule of equipmentRules) if (Number(counts.get(rule.id) || 0) < Number(rule.count || 0)) return rule.id;
  return null;
}
function overlap(state) {
  const ids = new Set(witnessEquipment.map((item) => String(item.id)));
  return (state?.items || []).filter((item) => ids.has(String(item.id))).length;
}

const eligibleItems = filterOptimizerEligibleItems(dataset.items);
const prefilter = buildEquipmentCandidatePools({ items: eligibleItems, sets: dataset.sets, constraints, fmPolicy, syntheticOffense, searchProfile: 'BALANCED' });
const setsById = Object.fromEntries(dataset.sets.map((set) => [set.id, set]));
const context = { axes, policy: prefilter.policy, setsById, fmPolicy, constraints, specialistKeys };
const corePools = boundedCorePools(prefilter.policy, axes);

const all = [];
for (const pattern of CORE_PATTERNS) {
  let states = [{ cores: [], items: [], stats: {}, score: 0, meanScore: 0, completionScore: 0, constraintSignal: 0, pattern: pattern.join('+') }];
  for (const pieceCount of pattern) {
    const expanded = [];
    for (const state of states) {
      for (const core of corePools.get(pieceCount) || []) {
        const cores = [...state.cores, core];
        if (!coresCompatible(cores)) continue;
        const items = cores.flatMap((entry) => entry.items);
        expanded.push({ cores, items, ...scoreState(items, prefilter.policy, setsById), pattern: state.pattern });
      }
    }
    states = retainCombinedArchitectureStates(expanded, 120, context);
    if (!states.length) break;
  }
  all.push(...states);
}
const architectures = retainFinalArchitectureCandidates(all, 180, context);
const witnessArchitecture = architectures.find((state) => itemKey(state.items) === itemKey(witnessCoreItems));
console.log(`FW_LARGE_COMPLETION_ARCHITECTURE_PRESENT=${witnessArchitecture ? 'YES' : 'NO'}`);
console.log(`FW_LARGE_COMPLETION_ARCHITECTURES=${architectures.length}`);

const slotPools = Object.fromEntries(equipmentRules.map((rule) => [rule.id, slotPool(rule.id, eligibleItems, prefilter, context)]));
const shieldPool = slotPools.shield || [];
const shieldIndex = shieldPool.findIndex((item) => String(item.id) === String(quatreFeuilles.id));
console.log(`FW_LARGE_COMPLETION_SHIELD_POOL_SIZE=${shieldPool.length}`);
console.log(`FW_LARGE_COMPLETION_QUATRE_FEUILLES_IN_POOL=${shieldIndex >= 0 ? 'YES' : 'NO'}`);
console.log(`FW_LARGE_COMPLETION_QUATRE_FEUILLES_POOL_RANK=${shieldIndex >= 0 ? shieldIndex + 1 : 'NA'}`);

let states = architectures;
const rounds = [];
for (let round = 0; round < 9; round++) {
  const expanded = [];
  let incomplete = false;
  for (const state of states) {
    const slot = firstMissingEquipmentSlot(state.items);
    if (!slot) { expanded.push(state); continue; }
    incomplete = true;
    const used = new Set(state.items.map((item) => String(item.id)));
    for (const item of slotPools[slot] || []) {
      if (used.has(String(item.id))) continue;
      const items = [...state.items, item];
      if (!equipmentShapeValid(items)) continue;
      expanded.push({ ...state, items, ...scoreState(items, prefilter.policy, setsById) });
    }
  }
  const witnessBefore = expanded.find((state) => itemKey(state.items) === witnessEquipmentKey) || null;
  const ranked = [...expanded].sort(comparePriority);
  const witnessRawRank = witnessBefore ? ranked.findIndex((state) => itemKey(state.items) === witnessEquipmentKey) + 1 : null;
  states = retainStates(expanded, 260, context);
  const witnessAfter = states.find((state) => itemKey(state.items) === witnessEquipmentKey) || null;
  rounds.push({ round, expanded: expanded.length, witnessBefore: Boolean(witnessBefore), witnessRawRank, witnessAfter: Boolean(witnessAfter), retained: states.length, bestOverlap: Math.max(0, ...states.map(overlap)) });
  if (!incomplete) break;
}
const completeStates = states.filter((state) => !firstMissingEquipmentSlot(state.items));
const witnessBeforeFinal = completeStates.find((state) => itemKey(state.items) === witnessEquipmentKey) || null;
const rankedComplete = [...completeStates].sort(comparePriority);
const witnessCompleteRank = witnessBeforeFinal ? rankedComplete.findIndex((state) => itemKey(state.items) === witnessEquipmentKey) + 1 : null;
const finalStates = retainStates(completeStates, 90, context);
const witnessAfterFinal = finalStates.find((state) => itemKey(state.items) === witnessEquipmentKey) || null;
console.log(`FW_LARGE_COMPLETION_ROUNDS=${JSON.stringify(rounds)}`);
console.log(`FW_LARGE_COMPLETION_FINAL=${JSON.stringify({ complete: completeStates.length, witnessBeforeFinal: Boolean(witnessBeforeFinal), witnessCompleteRank, retained: finalStates.length, witnessAfterFinal: Boolean(witnessAfterFinal), bestOverlap: Math.max(0, ...finalStates.map(overlap)) })}`);
