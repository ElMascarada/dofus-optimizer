import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

import { validateDofusSnapshot } from '../js/data-loader.js';
import { searchEquipmentRequest } from '../js/equipment-search-request.js';

const raw = JSON.parse(readFileSync(new URL('../data/normalized/dofus-data.json', import.meta.url), 'utf8'));
const dataset = validateDofusSnapshot(raw);
const startedAt = performance.now();
const output = searchEquipmentRequest({
  items: dataset.items,
  sets: dataset.sets,
  constraints: { ap: 12, mp: 6 },
  fmPolicy: { enabled: true, fmEnabled: true, exoAp: 1, exoMp: 1 },
  topN: 20,
  searchProfile: 'BALANCED',
  syntheticOffense: { elements: ['earth', 'fire'], profiles: ['large'], critMode: 'auto' }
});
const elapsedMs = performance.now() - startedAt;
const best = output.results?.[0] || null;
console.log(`PR120_PERF_TOTAL_MS=${elapsedMs.toFixed(1)}`);
console.log(`PR120_PERF_PHASES=${JSON.stringify(output.diagnostics?.performance || null)}`);
console.log(`PR120_PERF_DOFUS=${JSON.stringify(output.diagnostics?.exactDofusRefine || null)}`);
console.log(`PR120_PERF_RESULTS=${output.results?.length || 0}`);
console.log(`PR120_PERF_AP=${best?.stats?.ap ?? 'NA'}`);
console.log(`PR120_PERF_MP=${best?.stats?.mp ?? 'NA'}`);
