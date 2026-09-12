import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { validateDofusSnapshot } from '../js/data-loader.js';
import { addStats, emptyStats } from '../js/stats.js';
import { applySetBonuses } from '../js/sets.js';
import { specialSlotRulesAreValid } from '../js/build-legality.js';
import { buildEquipmentCandidatePools } from '../optimizer/equipment-candidate-policy.js';
import { filterOptimizerEligibleItems } from '../optimizer/item-eligibility.js';
import {
  boundedCorePools,
  combinedOffenseSearchScore,
  retainCombinedArchitectureStates
} from '../optimizer/combined-set-core-search.js';

const raw = JSON.parse(readFileSync(new URL('../data/normalized/dofus-data.json', import.meta.url), 'utf8'));
const dataset = validateDofusSnapshot(raw);
const constraints = { ap: 12, mp: 6 };
const fmPolicy = { enabled: true, fmEnabled: true, exoAp: 1, exoMp: 1 };
const syntheticOffense = { elements: ['fire', 'water'], profiles: ['large'], critMode: 'auto' };
const axes = ['fire', 'water'];
const CORE_PATTERNS = [
  [4, 3, 2], [4, 3], [4, 2, 2], [4, 2], [4],
  [3, 3, 3], [3, 3, 2], [3, 2, 2, 2], [3, 2, 2], [3, 3], [3, 2], [3],
  [2, 2, 2, 2], [2, 2, 2], [2, 2], [2]
];
const witnessNames = [
  "Masque de l'Esprit Malsain", 'Cape Ovri', 'Talisman Songe', 'Boulon de Mekamouth',
  'Écrou de Mekamouth', 'Sangle Ouare', "Bottes de l'Esprit Malsain", 'Bêche de Mekamouth'
];
const normalize = (value = '') => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const witness = witnessNames.map((name) => {
  const matches = dataset.items.filter((item) => normalize(item?.name) === normalize(name));
  assert.equal(matches.length, 1, `resolve ${name}`);
  return matches[0];
});
const witnessIds = new Set(witness.map((item) => String(item.id)));

function itemKey(items = []) { return items.map((item) => String(item?.id ?? '')).sort().join('|'); }
function itemStats(items = [], setsById = {}) {
  const stats = emptyStats();
  for (const item of items) addStats(stats, item?.stats || {});
  applySetBonuses(stats, items, setsById);
  return stats;
}
function scoreState(items, policy, setsById) {
  const stats = itemStats(items, setsById);
  const ranked = combinedOffenseSearchScore(policy, stats);
  return {
    stats,
    score: ranked.score,
    meanScore: ranked.meanScore,
    completionScore: ranked.completionScore,
    constraintSignal: ranked.constraintSignal
  };
}
function equipmentShapeValid(items = []) {
  const counts = new Map();
  const caps = { hat: 1, cape: 1, amulet: 1, ring: 2, belt: 1, boots: 1, weapon: 1, shield: 1 };
  for (const item of items) {
    const count = Number(counts.get(item.slot) || 0) + 1;
    if (count > Number(caps[item.slot] || 0)) return false;
    counts.set(item.slot, count);
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
function exactWitnessCoreState(states, count) {
  return states.find((state) => state.items.length === count && state.items.every((item) => witnessIds.has(String(item.id)))) || null;
}
function overlap(state) {
  return (state?.items || []).filter((item) => witnessIds.has(String(item.id))).length;
}

const eligibleItems = filterOptimizerEligibleItems(dataset.items);
const prefilter = buildEquipmentCandidatePools({
  items: eligibleItems,
  sets: dataset.sets,
  constraints,
  fmPolicy,
  syntheticOffense,
  searchProfile: 'BALANCED'
});
const setsById = Object.fromEntries(dataset.sets.map((set) => [set.id, set]));
const context = {
  axes,
  policy: prefilter.policy,
  setsById,
  fmPolicy,
  constraints,
  specialistKeys: ['fire', 'damageFire', 'water', 'damageWater', 'power', 'damage', 'spellDamagePct', 'crit', 'critDamage', 'ap', 'mp', 'range']
};
const corePools = boundedCorePools(prefilter.policy, axes);

const witnessSetCounts = new Map();
for (const item of witness) if (item.setId) witnessSetCounts.set(String(item.setId), Number(witnessSetCounts.get(String(item.setId)) || 0) + 1);
const exactCores = [...witnessSetCounts.entries()].map(([setId, pieceCount]) =>
  prefilter.policy.setCoreCatalog.cores.find((core) => String(core.setId) === setId
    && Number(core.pieceCount) === pieceCount
    && core.items.every((item) => witnessIds.has(String(item.id))))
).filter(Boolean);
console.log(`FW_LARGE_ARCH_EXACT_CORES=${JSON.stringify(exactCores.map((core) => ({ setName: core.setName, pieceCount: core.pieceCount, retained: (corePools.get(core.pieceCount) || []).some((candidate) => candidate.id === core.id) })))}`);

const all = [];
let targetRounds = [];
for (const pattern of CORE_PATTERNS) {
  let states = [{ cores: [], items: [], stats: {}, score: 0, meanScore: 0, completionScore: 0, constraintSignal: 0, pattern: pattern.join('+') }];
  let cumulative = 0;
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
    cumulative += pieceCount;
    const witnessBefore = exactWitnessCoreState(expanded, cumulative);
    const ranked = [...expanded].sort((a, b) => Number(b.score || 0) - Number(a.score || 0)
      || Number(b.meanScore || 0) - Number(a.meanScore || 0)
      || itemKey(a.items).localeCompare(itemKey(b.items)));
    const rawRank = witnessBefore ? ranked.findIndex((state) => itemKey(state.items) === itemKey(witnessBefore.items)) + 1 : null;
    states = retainCombinedArchitectureStates(expanded, 120, context);
    const witnessAfter = exactWitnessCoreState(states, cumulative);
    if (pattern.join('+') === '3+3+2') {
      targetRounds.push({
        pieceCount,
        cumulative,
        expanded: expanded.length,
        rawRank,
        witnessBefore: Boolean(witnessBefore),
        witnessAfter: Boolean(witnessAfter),
        retained: states.length,
        bestOverlap: Math.max(0, ...states.map(overlap))
      });
    }
    if (!states.length) break;
  }
  all.push(...states);
}
const beforeFinal = exactWitnessCoreState(all, 8);
const finalStates = retainCombinedArchitectureStates(all, 180, context);
const afterFinal = exactWitnessCoreState(finalStates, 8);
console.log(`FW_LARGE_ARCH_ROUNDS=${JSON.stringify(targetRounds)}`);
console.log(`FW_LARGE_ARCH_FINAL=${JSON.stringify({ beforeFinal: Boolean(beforeFinal), afterFinal: Boolean(afterFinal), all: all.length, retained: finalStates.length, bestOverlap: Math.max(0, ...finalStates.map(overlap)) })}`);
