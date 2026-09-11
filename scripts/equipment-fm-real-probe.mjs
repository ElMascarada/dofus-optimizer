import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

import { validateDofusSnapshot } from '../js/data-loader.js';
import { searchEquipmentArchitecturesV2 } from '../js/equipment-search-v2.js';

const raw = JSON.parse(readFileSync(new URL('../data/normalized/dofus-data.json', import.meta.url), 'utf8'));
const dataset = validateDofusSnapshot(raw);
const startedAt = performance.now();

const output = searchEquipmentArchitecturesV2({
  items: dataset.items,
  sets: dataset.sets,
  constraints: { ap: 12, mp: 6 },
  fmPolicy: { enabled: true, fmEnabled: true, exoAp: 1, exoMp: 1 },
  syntheticOffense: { elements: ['earth'], profiles: ['large'] },
  topN: 5,
  searchProfile: 'BALANCED'
});

const elapsedMs = performance.now() - startedAt;
const best = output.results?.[0] || null;
console.log(`FM_REAL_PROBE_RESULTS=${output.results?.length || 0}`);
console.log(`FM_REAL_PROBE_AP=${best?.stats?.ap ?? 'NA'}`);
console.log(`FM_REAL_PROBE_MP=${best?.stats?.mp ?? 'NA'}`);
console.log(`FM_REAL_PROBE_EXO_AP=${best?.fm?.exoAp ?? 'NA'}`);
console.log(`FM_REAL_PROBE_EXO_MP=${best?.fm?.exoMp ?? 'NA'}`);
console.log(`FM_REAL_PROBE_OFFENSIVE_SLOTS=${best?.fm?.offensiveSlots ?? 'NA'}`);
console.log(`FM_REAL_PROBE_MS=${elapsedMs.toFixed(1)}`);

if (!best) throw new Error('FM real catalog probe returned no legal build');
if (Number(best.stats?.ap) !== 12 || Number(best.stats?.mp) !== 6) {
  throw new Error(`FM real catalog probe expected 12/6, got ${best.stats?.ap}/${best.stats?.mp}`);
}
if (Number(best.fm?.exoAp) !== 1 || Number(best.fm?.exoMp) !== 1) {
  throw new Error('FM real catalog probe did not apply the PA/PM exo pair');
}
if (Number(best.fm?.offensiveSlots) !== 7) {
  throw new Error(`FM real catalog probe expected 7 offensive FM slots, got ${best.fm?.offensiveSlots}`);
}
