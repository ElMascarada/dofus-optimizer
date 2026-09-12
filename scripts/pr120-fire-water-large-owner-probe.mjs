import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

import { validateDofusSnapshot } from '../js/data-loader.js';
import {
  compareCompleteEquipmentBuildResults,
  evaluateCompleteEquipmentBuild
} from '../js/complete-equipment-build-evaluator.js';
import { searchEquipmentRequest } from '../js/equipment-search-request.js';

const raw = JSON.parse(readFileSync(new URL('../data/normalized/dofus-data.json', import.meta.url), 'utf8'));
const dataset = validateDofusSnapshot(raw);
const constraints = { ap: 12, mp: 6 };
const fmPolicy = { enabled: true, fmEnabled: true, exoAp: 1, exoMp: 1 };
const syntheticOffense = { elements: ['fire', 'water'], profiles: ['large'], critMode: 'auto' };

const witnessNames = [
  "Masque de l'Esprit Malsain", 'Cape Ovri', 'Talisman Songe',
  'Boulon de Mekamouth', 'Écrou de Mekamouth', 'Sangle Ouare',
  "Bottes de l'Esprit Malsain", 'Bêche de Mekamouth', 'Quatre-feuilles',
  'Kokulte', 'Impétueux', 'Arcaniste', 'Dofus des Glaces', 'Dofus Ocre',
  'Dofus Turquoise', 'Dofus Pourpre'
];

function normalize(value = '') {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}
function exactItem(name) {
  const wanted = normalize(name);
  const matches = dataset.items.filter((item) => normalize(item?.name) === wanted);
  if (matches.length !== 1) throw new Error(`witness resolution failed: ${name} matches=${matches.length}`);
  return matches[0];
}

const witnessItems = witnessNames.map(exactItem);
const witnessEval = evaluateCompleteEquipmentBuild({
  items: witnessItems,
  sets: dataset.sets,
  constraints,
  fmPolicy,
  syntheticOffense
});
if (!witnessEval.result) throw new Error(`OWNER_FIRE_WATER_LARGE_AUTO witness rejected: ${witnessEval.reason}`);

const startedAt = performance.now();
const output = searchEquipmentRequest({
  items: dataset.items,
  sets: dataset.sets,
  constraints,
  fmPolicy,
  topN: 20,
  searchProfile: 'BALANCED',
  syntheticOffense
});
const elapsedMs = performance.now() - startedAt;
const best = output.results?.[0] || null;
if (!best) throw new Error('OWNER_FIRE_WATER_LARGE_AUTO returned no legal build');

const comparison = compareCompleteEquipmentBuildResults(witnessEval.result, best);
console.log(`OWNER_FIRE_WATER_LARGE_AUTO_MS=${elapsedMs.toFixed(1)}`);
console.log(`OWNER_FIRE_WATER_LARGE_AUTO_SEARCH_MIN=${best.syntheticOffense?.minimumScore ?? 'NA'}`);
console.log(`OWNER_FIRE_WATER_LARGE_AUTO_WITNESS_MIN=${witnessEval.result.syntheticOffense?.minimumScore ?? 'NA'}`);
console.log(`OWNER_FIRE_WATER_LARGE_AUTO_VERDICT=${comparison > 0 ? 'WITNESS_BETTER' : comparison < 0 ? 'SEARCH_BETTER' : 'EQUAL'}`);
console.log(`OWNER_FIRE_WATER_LARGE_AUTO_DIRECT=${JSON.stringify(output.diagnostics || null)}`);
console.log(`OWNER_FIRE_WATER_LARGE_AUTO_ITEMS=${(best.items || []).map((item) => item?.name || item?.id).join(' | ')}`);

if (comparison > 0) {
  throw new Error('OWNER_FIRE_WATER_LARGE_AUTO quality regression: owner witness still beats optimizer top');
}
