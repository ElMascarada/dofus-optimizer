import { readFileSync } from 'node:fs';

import { validateDofusSnapshot } from '../js/data-loader.js';
import { effectiveStat } from '../js/stats.js';
import {
  compareCompleteEquipmentBuildResults,
  evaluateCompleteEquipmentBuild
} from '../js/complete-equipment-build-evaluator.js';
import { buildEquipmentCandidatePools } from '../optimizer/equipment-candidate-policy.js';
import { filterOptimizerEligibleItems } from '../optimizer/item-eligibility.js';

const raw = JSON.parse(readFileSync(new URL('../data/normalized/dofus-data.json', import.meta.url), 'utf8'));
const dataset = validateDofusSnapshot(raw);
const constraints = { ap: 12, mp: 6 };
const fmPolicy = { enabled: true, fmEnabled: true, exoAp: 1, exoMp: 1 };
const syntheticOffense = { elements: ['fire', 'water'], profiles: ['large'], critMode: 'auto' };
const specialistKeys = ['fire', 'damageFire', 'water', 'damageWater', 'power', 'damage', 'spellDamagePct', 'crit', 'critDamage', 'ap', 'mp', 'range'];

const normalize = (value = '') => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
function exactItem(name) {
  const wanted = normalize(name);
  const matches = dataset.items.filter((item) => normalize(item?.name) === wanted);
  if (matches.length !== 1) throw new Error(`resolution failed: ${name} matches=${matches.length}`);
  return matches[0];
}

const fixedNames = [
  "Masque de l'Esprit Malsain", 'Cape Ovri', 'Talisman Songe',
  'Boulon de Mekamouth', 'Écrou de Mekamouth', 'Sangle Ouare',
  "Bottes de l'Esprit Malsain", 'Bêche de Mekamouth',
  'Kokulte', 'Impétueux', 'Arcaniste', 'Dofus des Glaces', 'Dofus Ocre',
  'Dofus Turquoise', 'Dofus Pourpre'
];
const fixedItems = fixedNames.map(exactItem);
const quatreFeuilles = exactItem('Quatre-feuilles');

const eligibleItems = filterOptimizerEligibleItems(dataset.items);
const prefilter = buildEquipmentCandidatePools({
  items: eligibleItems,
  sets: dataset.sets,
  constraints,
  fmPolicy,
  syntheticOffense,
  searchProfile: 'BALANCED'
});

const rows = eligibleItems
  .filter((item) => item?.slot === 'shield')
  .map((item) => ({ item, profiled: prefilter.policy.profileItem(item) }));
const candidates = new Map();
const add = (item) => { if (item?.slot === 'shield') candidates.set(String(item.id), item); };
for (const item of prefilter.pools?.shield || []) add(item);
for (const row of [...rows].sort((a, b) => Number(b.profiled.objectiveGain || 0) - Number(a.profiled.objectiveGain || 0)
  || Number(b.profiled.meanGain || 0) - Number(a.profiled.meanGain || 0)
  || String(a.item.id).localeCompare(String(b.item.id))).slice(0, 18)) add(row.item);
for (const key of specialistKeys) {
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
const shieldPool = [...selected.values()];

const evaluated = [];
for (const shield of shieldPool) {
  const evaluation = evaluateCompleteEquipmentBuild({
    items: [...fixedItems, shield],
    sets: dataset.sets,
    constraints,
    fmPolicy,
    syntheticOffense
  });
  if (!evaluation.result) {
    evaluated.push({ shield, result: null, reason: evaluation.reason || 'unknown' });
    continue;
  }
  evaluated.push({ shield, result: evaluation.result, reason: null });
}
const valid = evaluated.filter((entry) => entry.result);
valid.sort((a, b) => -compareCompleteEquipmentBuildResults(a.result, b.result));
const qIndex = valid.findIndex((entry) => String(entry.shield.id) === String(quatreFeuilles.id));
const best = valid[0] || null;
const owner = valid.find((entry) => String(entry.shield.id) === String(quatreFeuilles.id)) || null;

console.log(`FW_LARGE_SHIELD_FINAL_POOL=${shieldPool.length}`);
console.log(`FW_LARGE_SHIELD_FINAL_VALID=${valid.length}`);
console.log(`FW_LARGE_QUATRE_FEUILLES_FINAL_RANK=${qIndex >= 0 ? qIndex + 1 : 'NA'}`);
console.log(`FW_LARGE_QUATRE_FEUILLES_FINAL_MIN=${owner?.result?.syntheticOffense?.minimumScore ?? 'NA'}`);
console.log(`FW_LARGE_BEST_SHIELD_FINAL=${JSON.stringify(best ? {
  name: best.shield.name,
  minimumScore: best.result.syntheticOffense?.minimumScore ?? null,
  meanScore: best.result.syntheticOffense?.meanScore ?? null,
  crit: best.result.stats?.crit ?? null,
  critDamage: best.result.stats?.critDamage ?? null
} : null)}`);
console.log(`FW_LARGE_TOP10_SHIELDS_FINAL=${JSON.stringify(valid.slice(0, 10).map((entry, index) => ({
  rank: index + 1,
  name: entry.shield.name,
  minimumScore: entry.result.syntheticOffense?.minimumScore ?? null,
  meanScore: entry.result.syntheticOffense?.meanScore ?? null
})))}`);
console.log(`FW_LARGE_BEST_BEATS_OWNER=${best && owner ? (compareCompleteEquipmentBuildResults(best.result, owner.result) < 0 ? 'NO' : compareCompleteEquipmentBuildResults(best.result, owner.result) > 0 ? 'YES' : 'EQUAL') : 'NA'}`);
