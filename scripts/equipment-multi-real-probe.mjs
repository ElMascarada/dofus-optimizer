import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

import { validateDofusSnapshot } from '../js/data-loader.js';
import { searchEquipmentRequest } from '../js/equipment-search-request.js';

const raw = JSON.parse(readFileSync(new URL('../data/normalized/dofus-data.json', import.meta.url), 'utf8'));
const dataset = validateDofusSnapshot(raw);
const common = {
  items: dataset.items,
  sets: dataset.sets,
  constraints: { ap: 12, mp: 6 },
  fmPolicy: { enabled: true, fmEnabled: true, exoAp: 1, exoMp: 1 },
  topN: 5,
  searchProfile: 'BALANCED'
};

const cases = [
  { name: 'TWO_ELEMENTS', elements: ['earth', 'fire'] },
  { name: 'THREE_ELEMENTS', elements: ['earth', 'fire', 'water'] },
  { name: 'MULTI', elements: ['multi'] }
];

for (const probe of cases) {
  const startedAt = performance.now();
  const output = searchEquipmentRequest({
    ...common,
    syntheticOffense: { elements: probe.elements, profiles: ['large'], critMode: 'auto' }
  });
  const elapsedMs = performance.now() - startedAt;
  const best = output.results?.[0] || null;
  console.log(`${probe.name}_REAL_PROBE_RESULTS=${output.results?.length || 0}`);
  console.log(`${probe.name}_REAL_PROBE_AP=${best?.stats?.ap ?? 'NA'}`);
  console.log(`${probe.name}_REAL_PROBE_MP=${best?.stats?.mp ?? 'NA'}`);
  console.log(`${probe.name}_REAL_PROBE_MS=${elapsedMs.toFixed(1)}`);
  if (!best) throw new Error(`${probe.name} real catalog probe returned no legal build`);
  if (Number(best.stats?.ap) !== 12 || Number(best.stats?.mp) !== 6) {
    throw new Error(`${probe.name} real catalog probe expected 12/6, got ${best.stats?.ap}/${best.stats?.mp}`);
  }
  if (Number(best.fm?.exoAp) !== 1 || Number(best.fm?.exoMp) !== 1) {
    throw new Error(`${probe.name} real catalog probe did not retain the PA/PM exo pair`);
  }
}
