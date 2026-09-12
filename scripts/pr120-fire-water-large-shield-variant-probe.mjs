import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { validateDofusSnapshot } from '../js/data-loader.js';
import { addStats, effectiveStat, emptyStats } from '../js/stats.js';
import { applySetBonuses } from '../js/sets.js';
import { combinedOffenseSearchScore } from '../optimizer/combined-set-core-search.js';
import { buildEquipmentCandidatePools } from '../optimizer/equipment-candidate-policy.js';
import { filterOptimizerEligibleItems } from '../optimizer/item-eligibility.js';

const raw = JSON.parse(readFileSync(new URL('../data/normalized/dofus-data.json', import.meta.url), 'utf8'));
const dataset = validateDofusSnapshot(raw);
const constraints = { ap: 12, mp: 6 };
const fmPolicy = { enabled: true, fmEnabled: true, exoAp: 1, exoMp: 1 };
const syntheticOffense = { elements: ['fire', 'water'], profiles: ['large'], critMode: 'auto' };
const specialistKeys = ['fire', 'damageFire', 'water', 'damageWater', 'power', 'damage', 'spellDamagePct', 'crit', 'critDamage', 'ap', 'mp', 'range'];
const normalize = (value = '') => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const coreNames = [
  "Masque de l'Esprit Malsain", 'Cape Ovri', 'Talisman Songe', 'Boulon de Mekamouth',
  'Écrou de Mekamouth', 'Sangle Ouare', "Bottes de l'Esprit Malsain", 'Bêche de Mekamouth'
];
const resolveOne = (name) => {
  const matches = dataset.items.filter((item) => normalize(item?.name) === normalize(name));
  assert.equal(matches.length, 1, `resolve ${name}`);
  return matches[0];
};
const coreItems = coreNames.map(resolveOne);
const quatreFeuilles = resolveOne('Quatre-feuilles');
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

function statsFor(items = []) {
  const stats = emptyStats();
  for (const item of items) addStats(stats, item?.stats || {});
  applySetBonuses(stats, items, setsById);
  return stats;
}
function score(items = []) {
  const stats = statsFor(items);
  const ranked = combinedOffenseSearchScore(prefilter.policy, stats);
  return {
    score: Number(ranked.score || 0),
    meanScore: Number(ranked.meanScore || 0),
    completionScore: Number(ranked.completionScore || 0),
    stats
  };
}
function compare(a, b) {
  return b.score - a.score || b.meanScore - a.meanScore || String(a.item.id).localeCompare(String(b.item.id));
}

const candidates = new Map();
const add = (item) => { if (item?.slot === 'shield') candidates.set(String(item.id), item); };
for (const item of prefilter.pools?.shield || []) add(item);
const rows = eligibleItems
  .filter((item) => item?.slot === 'shield')
  .map((item) => ({ item, profiled: prefilter.policy.profileItem(item) }));
const offenseRows = [...rows].sort((a, b) => Number(b.profiled.objectiveGain || 0) - Number(a.profiled.objectiveGain || 0)
  || Number(b.profiled.meanGain || 0) - Number(a.profiled.meanGain || 0)
  || String(a.item.id).localeCompare(String(b.item.id)));
for (const row of offenseRows.slice(0, 18)) add(row.item);
for (const key of [...new Set([...specialistKeys, 'ap', 'mp'])]) {
  for (const row of [...rows]
    .filter((entry) => effectiveStat(entry.profiled.optimisticStats || {}, key) > 0)
    .sort((a, b) => effectiveStat(b.profiled.optimisticStats || {}, key) - effectiveStat(a.profiled.optimisticStats || {}, key)
      || Number(b.profiled.objectiveGain || 0) - Number(a.profiled.objectiveGain || 0)
      || Number(b.profiled.meanGain || 0) - Number(a.profiled.meanGain || 0))
    .slice(0, 4)) add(row.item);
}
const candidateRows = [...candidates.values()].map((item) => ({ item, profiled: prefilter.policy.profileItem(item) }));
const selected = new Map();
for (const key of ['ap', 'mp']) {
  for (const row of [...candidateRows]
    .filter((entry) => effectiveStat(entry.profiled.optimisticStats || {}, key) > 0)
    .sort((a, b) => effectiveStat(b.profiled.optimisticStats || {}, key) - effectiveStat(a.profiled.optimisticStats || {}, key)
      || Number(b.profiled.objectiveGain || 0) - Number(a.profiled.objectiveGain || 0)
      || Number(b.profiled.meanGain || 0) - Number(a.profiled.meanGain || 0))
    .slice(0, 2)) {
    if (selected.size >= 28) break;
    selected.set(String(row.item.id), row.item);
  }
}
for (const row of candidateRows.sort((a, b) => Number(b.profiled.objectiveGain || 0) - Number(a.profiled.objectiveGain || 0)
  || Number(b.profiled.meanGain || 0) - Number(a.profiled.meanGain || 0)
  || Number(b.profiled.rankScore || 0) - Number(a.profiled.rankScore || 0)
  || String(a.item.id).localeCompare(String(b.item.id)))) {
  if (selected.size >= 28) break;
  selected.set(String(row.item.id), row.item);
}

const variants = [...selected.values()].map((item) => ({ item, ...score([...coreItems, item]) })).sort(compare);
const qIndex = variants.findIndex((row) => String(row.item.id) === String(quatreFeuilles.id));
const q = qIndex >= 0 ? variants[qIndex] : null;
console.log(`FW_LARGE_SHIELD_VARIANTS=${variants.length}`);
console.log(`FW_LARGE_QUATRE_FEUILLES_VARIANT_RANK=${qIndex >= 0 ? qIndex + 1 : 'NA'}`);
console.log(`FW_LARGE_QUATRE_FEUILLES_SCORE=${q ? q.score : 'NA'}`);
console.log(`FW_LARGE_BEST_SHIELD=${JSON.stringify(variants[0] ? { name: variants[0].item.name, score: variants[0].score, meanScore: variants[0].meanScore } : null)}`);
console.log(`FW_LARGE_TOP10_SHIELDS=${JSON.stringify(variants.slice(0, 10).map((row, index) => ({ rank: index + 1, name: row.item.name, score: row.score, meanScore: row.meanScore })))}`);
console.log(`FW_LARGE_QUATRE_FEUILLES_STATS=${JSON.stringify(quatreFeuilles.stats || {})}`);
