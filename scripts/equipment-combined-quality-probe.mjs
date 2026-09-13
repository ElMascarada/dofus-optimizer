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
const common = {
  items: dataset.items,
  sets: dataset.sets,
  constraints: { ap: 12, mp: 6 },
  fmPolicy: { enabled: true, fmEnabled: true, exoAp: 1, exoMp: 1 },
  topN: 20,
  searchProfile: 'BALANCED'
};

const witnessNames = [
  "Masque de l'Esprit Malsain",
  'Cape Ovri',
  'Talisman Songe',
  'Boulon de Mekamouth',
  'Écrou de Mekamouth',
  'Sangle Ouare',
  "Bottes de l'Esprit Malsain",
  'Bêche de Mekamouth',
  'Quatre-feuilles',
  'Kokulte',
  'Impétueux',
  'Arcaniste',
  'Dofus des Glaces',
  'Dofus Ocre',
  'Dofus Turquoise',
  'Dofus Pourpre'
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
const cases = [
  { name: 'OWNER_FIRE_WATER_SMALL_AUTO', profiles: ['small'] },
  { name: 'OWNER_FIRE_WATER_LARGE_AUTO', profiles: ['large'] }
];

for (const probe of cases) {
  const syntheticOffense = { elements: ['fire', 'water'], profiles: probe.profiles, critMode: 'auto' };
  const witnessEval = evaluateCompleteEquipmentBuild({
    items: witnessItems,
    sets: dataset.sets,
    constraints: common.constraints,
    fmPolicy: common.fmPolicy,
    syntheticOffense
  });
  if (!witnessEval.result) throw new Error(`${probe.name} witness rejected: ${witnessEval.reason}`);

  const startedAt = performance.now();
  const output = searchEquipmentRequest({ ...common, syntheticOffense });
  const elapsedMs = performance.now() - startedAt;
  const best = output.results?.[0] || null;
  if (!best) throw new Error(`${probe.name} returned no legal build`);

  const comparison = compareCompleteEquipmentBuildResults(witnessEval.result, best);
  console.log(`${probe.name}_MS=${elapsedMs.toFixed(1)}`);
  console.log(`${probe.name}_SEARCH_MIN=${best.syntheticOffense?.minimumScore ?? 'NA'}`);
  console.log(`${probe.name}_WITNESS_MIN=${witnessEval.result.syntheticOffense?.minimumScore ?? 'NA'}`);
  console.log(`${probe.name}_VERDICT=${comparison > 0 ? 'WITNESS_BETTER' : comparison < 0 ? 'SEARCH_BETTER' : 'EQUAL'}`);
  console.log(`${probe.name}_PHASES=${JSON.stringify(output.diagnostics?.performance || null)}`);
  console.log(`${probe.name}_DOFUS=${JSON.stringify(output.diagnostics?.exactDofusRefine || null)}`);

  if (comparison > 0) {
    throw new Error(`${probe.name} quality regression: owner witness still beats optimizer top`);
  }
}
