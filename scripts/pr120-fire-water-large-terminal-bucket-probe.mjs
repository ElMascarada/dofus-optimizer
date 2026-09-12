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
const normalize = (value = '') => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const wanted = [
  "Masque de l'Esprit Malsain", 'Cape Ovri', 'Talisman Songe', 'Boulon de Mekamouth',
  'Écrou de Mekamouth', 'Sangle Ouare', "Bottes de l'Esprit Malsain", 'Bêche de Mekamouth'
];
const witness = wanted.map((name) => {
  const matches = dataset.items.filter((item) => normalize(item?.name) === normalize(name));
  assert.equal(matches.length, 1, `resolve ${name}`);
  return matches[0];
});
const witnessIds = new Set(witness.map((item) => String(item.id)));
const itemKey = (items = []) => items.map((item) => String(item?.id ?? '')).sort().join('|');
const itemStats = (items, setsById) => {
  const stats = emptyStats();
  for (const item of items) addStats(stats, item?.stats || {});
  applySetBonuses(stats, items, setsById);
  return stats;
};
const scoreState = (items, policy, setsById) => {
  const stats = itemStats(items, setsById);
  const ranked = combinedOffenseSearchScore(policy, stats);
  return { stats, score: ranked.score, meanScore: ranked.meanScore, completionScore: ranked.completionScore, constraintSignal: ranked.constraintSignal };
};
const compare = (a, b) => Number(b.score || 0) - Number(a.score || 0)
  || Number(b.meanScore || 0) - Number(a.meanScore || 0)
  || itemKey(a.items).localeCompare(itemKey(b.items));
function compatible(cores = []) {
  const sets = new Set(); const ids = new Set(); const counts = new Map();
  for (const core of cores) {
    if (sets.has(String(core.setId))) return false;
    sets.add(String(core.setId));
    for (const item of core.items || []) {
      if (ids.has(String(item.id))) return false;
      ids.add(String(item.id));
      counts.set(item.slot, Number(counts.get(item.slot) || 0) + 1);
    }
  }
  const caps = { hat: 1, cape: 1, amulet: 1, ring: 2, belt: 1, boots: 1, weapon: 1, shield: 1 };
  for (const [slot, count] of counts) if (count > Number(caps[slot] || 0)) return false;
  return specialSlotRulesAreValid(cores.flatMap((core) => core.items || []));
}

const eligibleItems = filterOptimizerEligibleItems(dataset.items);
const prefilter = buildEquipmentCandidatePools({ items: eligibleItems, sets: dataset.sets, constraints, fmPolicy, syntheticOffense, searchProfile: 'BALANCED' });
const setsById = Object.fromEntries(dataset.sets.map((set) => [set.id, set]));
const context = { axes, policy: prefilter.policy, setsById, fmPolicy, constraints,
  specialistKeys: ['fire', 'damageFire', 'water', 'damageWater', 'power', 'damage', 'spellDamagePct', 'crit', 'critDamage', 'ap', 'mp', 'range'] };
const pools = boundedCorePools(prefilter.policy, axes);
const witnessCounts = new Map();
for (const item of witness) if (item.setId) witnessCounts.set(String(item.setId), Number(witnessCounts.get(String(item.setId)) || 0) + 1);
const exactCores = [...witnessCounts.entries()].map(([setId, count]) => prefilter.policy.setCoreCatalog.cores.find((core) => String(core.setId) === setId && Number(core.pieceCount) === count && core.items.every((item) => witnessIds.has(String(item.id))))).filter(Boolean);
const bonimenteur = exactCores.find((core) => /Bonimenteur/i.test(String(core.setName)));
const mekamouth = exactCores.find((core) => /Mekamouth/i.test(String(core.setName)));
assert.ok(bonimenteur && mekamouth, 'witness 3-piece cores');

let first = [];
for (const core of pools.get(3) || []) {
  first.push({ cores: [core], items: [...core.items], ...scoreState(core.items, prefilter.policy, setsById), pattern: '3+3+2' });
}
first = retainCombinedArchitectureStates(first, 120, context);
const expanded = [];
for (const state of first) {
  for (const core of pools.get(3) || []) {
    const cores = [...state.cores, core];
    if (!compatible(cores)) continue;
    const items = cores.flatMap((entry) => entry.items);
    expanded.push({ cores, items, ...scoreState(items, prefilter.policy, setsById), pattern: '3+3+2' });
  }
}
const witnessKey = itemKey([...bonimenteur.items, ...mekamouth.items]);
const witnessState = expanded.find((state) => itemKey(state.items) === witnessKey);
assert.ok(witnessState, 'witness pair before retention');
const ranked = [...expanded].sort(compare);
const terminalBucket = ranked.filter((state) => String(state.cores.at(-1)?.setId) === String(mekamouth.setId));
const parentBonimenteurBucket = terminalBucket.filter((state) => String(state.cores[0]?.setId) === String(bonimenteur.setId));
const terminalRank = terminalBucket.findIndex((state) => itemKey(state.items) === witnessKey) + 1;
const globalRank = ranked.findIndex((state) => itemKey(state.items) === witnessKey) + 1;
const distinctParentsAhead = new Set(terminalBucket.slice(0, Math.max(0, terminalRank - 1)).map((state) => String(state.cores[0]?.setId))).size;
console.log(`FW_LARGE_PAIR_GLOBAL_RANK=${globalRank}`);
console.log(`FW_LARGE_MEKAMOUTH_BUCKET_SIZE=${terminalBucket.length}`);
console.log(`FW_LARGE_PAIR_RANK_WITHIN_MEKAMOUTH=${terminalRank}`);
console.log(`FW_LARGE_DISTINCT_PARENTS_AHEAD=${distinctParentsAhead}`);
console.log(`FW_LARGE_BONIMENTEUR_MEKAMOUTH_VARIANTS=${parentBonimenteurBucket.length}`);
console.log(`FW_LARGE_PAIR_AFTER_CURRENT_RETENTION=${retainCombinedArchitectureStates(expanded, 120, context).some((state) => itemKey(state.items) === witnessKey) ? 'YES' : 'NO'}`);
