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
const corePatterns = [
  [4, 3, 2], [4, 3], [4, 2, 2], [4, 2], [4],
  [3, 3, 3], [3, 3, 2], [3, 2, 2, 2], [3, 2, 2], [3, 3], [3, 2], [3],
  [2, 2, 2, 2], [2, 2, 2], [2, 2], [2]
];

const normalize = (value = '') => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const exactItem = (name) => {
  const matches = dataset.items.filter((item) => normalize(item?.name) === normalize(name));
  assert.equal(matches.length, 1, `resolve ${name}`);
  return matches[0];
};
const itemKey = (items = []) => items.map((item) => String(item?.id ?? '')).sort().join('|');
const architectureKey = (state) => (state?.cores || []).map((core) => String(core?.id ?? '')).filter(Boolean).sort().join('|');

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
function setSignature(items = []) {
  const counts = new Map();
  for (const item of items) if (item?.setId) counts.set(String(item.setId), Number(counts.get(String(item.setId)) || 0) + 1);
  return [...counts.entries()]
    .filter(([, count]) => count >= 2)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, count]) => `${id}:${count}`)
    .join(',');
}
function resourceBucket(items, setsById) {
  const stats = contextualStats(items, setsById);
  return `${Math.min(12, effectiveStat(stats, 'ap'))}:${Math.min(6, effectiveStat(stats, 'mp'))}:${setSignature(items)}`;
}
function positiveConstraintKeys() {
  return Object.entries(constraints).filter(([, minimum]) => Number(minimum) > 0).map(([key]) => key);
}
function slotPool(slot, eligibleItems, prefilter, context) {
  const candidates = new Map();
  const add = (item) => { if (item?.slot === slot) candidates.set(String(item.id), item); };
  for (const item of prefilter.pools?.[slot] || []) add(item);
  const rows = eligibleItems.filter((item) => item?.slot === slot).map((item) => ({ item, profiled: context.policy.profileItem(item) }));
  for (const row of [...rows].sort((a, b) => Number(b.profiled.objectiveGain || 0) - Number(a.profiled.objectiveGain || 0)
    || Number(b.profiled.meanGain || 0) - Number(a.profiled.meanGain || 0)
    || String(a.item.id).localeCompare(String(b.item.id))).slice(0, 18)) add(row.item);
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
function firstByKey(ranked, keyFn) {
  const map = new Map();
  for (const state of ranked) {
    const key = keyFn(state);
    if (key && !map.has(key)) map.set(key, state);
  }
  return map;
}

const ownerCoreNames = [
  "Masque de l'Esprit Malsain", 'Cape Ovri', 'Talisman Songe', 'Boulon de Mekamouth',
  'Écrou de Mekamouth', 'Sangle Ouare', "Bottes de l'Esprit Malsain", 'Bêche de Mekamouth'
];
const ownerCoreItems = ownerCoreNames.map(exactItem);
const ownerCoreKey = itemKey(ownerCoreItems);

const eligibleItems = filterOptimizerEligibleItems(dataset.items);
const prefilter = buildEquipmentCandidatePools({ items: eligibleItems, sets: dataset.sets, constraints, fmPolicy, syntheticOffense, searchProfile: 'BALANCED' });
const setsById = Object.fromEntries(dataset.sets.map((set) => [set.id, set]));
const context = { axes, policy: prefilter.policy, setsById, fmPolicy, constraints, specialistKeys };
const corePools = boundedCorePools(prefilter.policy, axes);

const all = [];
for (const pattern of corePatterns) {
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
const ownerArchitecture = architectures.find((state) => itemKey(state.items) === ownerCoreKey);
assert.ok(ownerArchitecture, 'owner architecture must survive architecture retention');
const ownerArchitectureKey = architectureKey(ownerArchitecture);

const slotPools = Object.fromEntries(equipmentRules.map((rule) => [rule.id, slotPool(rule.id, eligibleItems, prefilter, context)]));
const expanded = [];
for (const state of architectures) {
  const slot = firstMissingEquipmentSlot(state.items);
  if (!slot) {
    expanded.push(state);
    continue;
  }
  const used = new Set(state.items.map((item) => String(item.id)));
  for (const item of slotPools[slot] || []) {
    if (used.has(String(item.id))) continue;
    const items = [...state.items, item];
    if (!equipmentShapeValid(items)) continue;
    expanded.push({ ...state, items, ...scoreState(items, prefilter.policy, setsById) });
  }
}

const ranked = [...expanded].sort(comparePriority);
const bestByArchitecture = firstByKey(ranked, architectureKey);
const ownerBest = bestByArchitecture.get(ownerArchitectureKey);
assert.ok(ownerBest, 'owner architecture must have completion child');

const ownerBucket = resourceBucket(ownerBest.items, setsById);
const ownerSetSignature = setSignature(ownerBest.items);
const ownerPatternSetKey = `${ownerBest.pattern}|${ownerSetSignature}`;
const bestByBucket = firstByKey(ranked, (state) => resourceBucket(state.items, setsById));
const bestBySet = firstByKey(ranked, (state) => setSignature(state.items));
const bestByPatternSet = firstByKey(ranked, (state) => `${state.pattern}|${setSignature(state.items)}`);
const bucketWinners = [...bestByBucket.values()].sort(comparePriority);
const setWinners = [...bestBySet.values()].sort(comparePriority);
const patternSetWinners = [...bestByPatternSet.values()].sort(comparePriority);
const ownerBucketRows = ranked.filter((state) => resourceBucket(state.items, setsById) === ownerBucket);
const ownerSetRows = ranked.filter((state) => setSignature(state.items) === ownerSetSignature);

const rankOf = (rows, predicate) => {
  const index = rows.findIndex(predicate);
  return index < 0 ? null : index + 1;
};
const describe = (state) => state ? {
  score: state.score,
  pattern: state.pattern,
  shield: state.items.find((item) => item.slot === 'shield')?.name || null,
  architecture: architectureKey(state),
  bucket: resourceBucket(state.items, setsById),
  setSignature: setSignature(state.items)
} : null;

console.log(`FW_LARGE_COMPLETION_EXPANDED=${ranked.length}`);
console.log(`FW_LARGE_COMPLETION_DISTINCT_ARCHITECTURES=${bestByArchitecture.size}`);
console.log(`FW_LARGE_COMPLETION_DISTINCT_RESOURCE_BUCKETS=${bestByBucket.size}`);
console.log(`FW_LARGE_COMPLETION_DISTINCT_SET_SIGNATURES=${bestBySet.size}`);
console.log(`FW_LARGE_COMPLETION_DISTINCT_PATTERN_SET_KEYS=${bestByPatternSet.size}`);
console.log(`FW_LARGE_COMPLETION_OWNER_BEST=${JSON.stringify(describe(ownerBest))}`);
console.log(`FW_LARGE_COMPLETION_OWNER_GLOBAL_RANK=${rankOf(ranked, (state) => itemKey(state.items) === itemKey(ownerBest.items))}`);
console.log(`FW_LARGE_COMPLETION_OWNER_ARCH_WINNER_RANK=${rankOf([...bestByArchitecture.values()].sort(comparePriority), (state) => architectureKey(state) === ownerArchitectureKey)}`);
console.log(`FW_LARGE_COMPLETION_OWNER_BUCKET_SIZE=${ownerBucketRows.length}`);
console.log(`FW_LARGE_COMPLETION_OWNER_RANK_IN_BUCKET=${rankOf(ownerBucketRows, (state) => itemKey(state.items) === itemKey(ownerBest.items))}`);
console.log(`FW_LARGE_COMPLETION_OWNER_BUCKET_WINNER=${JSON.stringify(describe(bestByBucket.get(ownerBucket)))}`);
console.log(`FW_LARGE_COMPLETION_OWNER_BUCKET_WINNER_RANK=${rankOf(bucketWinners, (state) => resourceBucket(state.items, setsById) === ownerBucket)}`);
console.log(`FW_LARGE_COMPLETION_OWNER_SET_SIZE=${ownerSetRows.length}`);
console.log(`FW_LARGE_COMPLETION_OWNER_RANK_IN_SET=${rankOf(ownerSetRows, (state) => itemKey(state.items) === itemKey(ownerBest.items))}`);
console.log(`FW_LARGE_COMPLETION_OWNER_SET_WINNER=${JSON.stringify(describe(bestBySet.get(ownerSetSignature)))}`);
console.log(`FW_LARGE_COMPLETION_OWNER_SET_WINNER_RANK=${rankOf(setWinners, (state) => setSignature(state.items) === ownerSetSignature)}`);
console.log(`FW_LARGE_COMPLETION_OWNER_PATTERN_SET_WINNER=${JSON.stringify(describe(bestByPatternSet.get(ownerPatternSetKey)))}`);
console.log(`FW_LARGE_COMPLETION_OWNER_PATTERN_SET_WINNER_RANK=${rankOf(patternSetWinners, (state) => `${state.pattern}|${setSignature(state.items)}` === ownerPatternSetKey)}`);
