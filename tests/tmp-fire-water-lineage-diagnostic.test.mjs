import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { BASE_CHARACTER, SLOT_RULES } from '../js/config.js';
import { validateDofusSnapshot } from '../js/data-loader.js';
import { addStats, effectiveStat, emptyStats } from '../js/stats.js';
import { applySetBonuses } from '../js/sets.js';
import { specialSlotRulesAreValid } from '../js/build-legality.js';
import { statsWithStructuralExos } from '../js/structural-exos.js';
import { buildEquipmentCandidatePools } from '../optimizer/equipment-candidate-policy.js';
import { combinedOffenseSearchScore } from '../optimizer/combined-set-core-search.js';

const raw = JSON.parse(readFileSync(new URL('../data/normalized/dofus-data.json', import.meta.url), 'utf8'));
const dataset = validateDofusSnapshot(raw);
const constraints = { ap: 12, mp: 6 };
const fmPolicy = { enabled: true, fmEnabled: true, exoAp: 1, exoMp: 1 };
const syntheticOffense = { elements: ['fire', 'water'], profiles: ['small'], critMode: 'auto' };
const axes = ['fire', 'water'];
const elementDamage = { earth: 'damageEarth', fire: 'damageFire', water: 'damageWater', air: 'damageAir' };
const equipmentRules = SLOT_RULES.filter((rule) => !['companion', 'dofus'].includes(rule.id));
const equipmentCaps = new Map(equipmentRules.map((rule) => [rule.id, Number(rule.count || 0)]));
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
const witnessIds = new Set(witness.map((item) => String(item.id)));
const witnessEquipment = witness.filter((item) => !['companion', 'dofus', 'shield'].includes(item.slot));
const witnessEquipmentIds = new Set(witnessEquipment.map((item) => String(item.id)));
const witnessSetCounts = new Map();
for (const item of witnessEquipment) {
  if (item.setId) witnessSetCounts.set(String(item.setId), Number(witnessSetCounts.get(String(item.setId)) || 0) + 1);
}

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
  for (const statKey of specialistKeys()) {
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
  return { stats, score: ranked.score, meanScore: ranked.meanScore };
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
function isWitnessSubset(items = []) { return items.every((item) => witnessEquipmentIds.has(String(item.id))); }
function witnessOverlap(items = []) { return items.filter((item) => witnessEquipmentIds.has(String(item.id))).length; }
function exactWitnessState(states = [], size) { return states.find((state) => state.items.length === size && isWitnessSubset(state.items)) || null; }

function summarizeCore(core) { return core ? { id: core.id, setId: core.setId, setName: core.setName, pieceCount: core.pieceCount, names: core.items.map((item) => item.name) } : null; }

const prefilter = buildEquipmentCandidatePools({ items: dataset.items, sets: dataset.sets, constraints, fmPolicy, syntheticOffense, searchProfile: 'BALANCED' });
const policy = prefilter.policy;
const setsById = setsByIdFor(dataset.sets);
const fullCores = policy.setCoreCatalog?.cores || [];
const exactWitnessCores = [...witnessSetCounts.entries()].map(([setId, pieceCount]) => fullCores.find((core) => String(core.setId) === setId && Number(core.pieceCount) === pieceCount && core.items.every((item) => witnessEquipmentIds.has(String(item.id))))).filter(Boolean);

const corePools = boundedCorePools(policy);
const boundedPresence = exactWitnessCores.map((core) => ({ id: core.id, setName: core.setName, pieceCount: core.pieceCount, retained: (corePools.get(core.pieceCount) || []).some((candidate) => candidate.id === core.id) }));

function runPattern(pattern) {
  let states = [{ cores: [], items: [], stats: {}, score: 0, meanScore: 0, pattern: pattern.join('+') }];
  const rounds = [];
  let cumulative = 0;
  for (const pieceCount of pattern) {
    cumulative += pieceCount;
    const expanded = [];
    for (const state of states) {
      for (const core of corePools.get(pieceCount) || []) {
        const cores = [...state.cores, core];
        if (!coresCompatible(cores)) continue;
        const items = cores.flatMap((entry) => entry.items);
        const ranked = scoreState(items, policy, setsById);
        expanded.push({ cores, items, ...ranked, pattern: state.pattern });
      }
    }
    const exactBefore = exactWitnessState(expanded, cumulative);
    const ranked = [...expanded].sort(compareStatePriority);
    const rawRank = exactBefore ? ranked.findIndex((state) => itemKey(state.items) === itemKey(exactBefore.items)) + 1 : null;
    states = retainStates(expanded, 120, { setsById });
    const exactAfter = exactWitnessState(states, cumulative);
    rounds.push({ pieceCount, cumulative, expanded: expanded.length, rawRank, witnessBefore: Boolean(exactBefore), witnessAfter: Boolean(exactAfter), retained: states.length, bestOverlap: Math.max(0, ...states.map((state) => witnessOverlap(state.items))) });
  }
  return rounds;
}

test('TEMP diagnostic: Fire/Water owner witness set-core lineage', () => {
  console.log(`FW_LINEAGE_WITNESS_SET_COUNTS=${JSON.stringify([...witnessSetCounts.entries()])}`);
  console.log(`FW_LINEAGE_EXACT_CORES=${JSON.stringify(exactWitnessCores.map(summarizeCore))}`);
  console.log(`FW_LINEAGE_BOUNDED_CORE_PRESENCE=${JSON.stringify(boundedPresence)}`);
  console.log(`FW_LINEAGE_PATTERN_3_3_2=${JSON.stringify(runPattern([3, 3, 2]))}`);
  assert.ok(true);
});
