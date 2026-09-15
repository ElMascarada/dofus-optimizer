import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

import { validateDofusSnapshot } from '../js/data-loader.js';
import { searchCombinedSetCoreEquipment } from '../optimizer/combined-set-core-search.js';
import { refineDofusPackagesForResults } from '../optimizer/dofus-package-refiner-contextual.js';

const raw = JSON.parse(readFileSync(new URL('../data/normalized/dofus-data.json', import.meta.url), 'utf8'));
const dataset = validateDofusSnapshot(raw);

const constraints = { ap: 12, mp: 5 };
const fmPolicy = { enabled: true, fmEnabled: true, exoAp: 1, exoMp: 1 };
const syntheticOffense = {
  elements: ['earth', 'fire', 'air'],
  profiles: ['large'],
  critMode: 'no_crit'
};
const common = {
  items: dataset.items,
  sets: dataset.sets,
  constraints,
  fmPolicy,
  syntheticOffense,
  topN: 160,
  searchProfile: 'BALANCED'
};

console.log('CASE=TRI_DOFUS_REFINE_TIMING');
console.log(`REQUEST=${JSON.stringify({ constraints, fmPolicy, syntheticOffense, topN: 160 })}`);

console.log('DIRECT_BEGIN=1');
const directStartedAt = performance.now();
const direct = searchCombinedSetCoreEquipment(common);
const directMs = performance.now() - directStartedAt;
console.log('DIRECT_END=1');
console.log(`DIRECT_MS=${directMs.toFixed(1)}`);
console.log(`DIRECT_RESULTS=${direct.results?.length || 0}`);
console.log(`DIRECT_DIAGNOSTICS=${JSON.stringify(direct.diagnostics || null)}`);

if (!(direct.results || []).length) {
  console.log('CLASSIFICATION=DIRECT_EMPTY');
  process.exitCode = 2;
} else {
  console.log('REFINE1_BEGIN=1');
  const refineStartedAt = performance.now();
  const refined = refineDofusPackagesForResults({
    results: direct.results,
    items: dataset.items,
    sets: dataset.sets,
    constraints,
    fmPolicy,
    syntheticOffense,
    searchProfile: 'BALANCED',
    topN: 160,
    baseContextLimit: 1
  });
  const refineMs = performance.now() - refineStartedAt;
  console.log('REFINE1_END=1');
  console.log(`REFINE1_MS=${refineMs.toFixed(1)}`);
  console.log(`REFINE1_RESULTS=${refined.results?.length || 0}`);
  console.log(`REFINE1_DIAGNOSTICS=${JSON.stringify(refined.diagnostics || null)}`);
  console.log('CLASSIFICATION=MEASURED');
}
