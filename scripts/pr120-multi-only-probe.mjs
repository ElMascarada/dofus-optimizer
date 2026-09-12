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
  syntheticOffense: { elements: ['multi'], profiles: ['large'], critMode: 'auto' }
});
const elapsedMs = performance.now() - startedAt;
const best = output.results?.[0] || null;
const diagnostics = output.diagnostics || {};
const multiScores = best?.syntheticOffense?.multiElementScores || null;

console.log(`PR120_MULTI_ONLY_MS=${elapsedMs.toFixed(1)}`);
console.log(`PR120_MULTI_ONLY_RESULTS=${output.results?.length || 0}`);
console.log(`PR120_MULTI_ONLY_AP=${best?.stats?.ap ?? 'NA'}`);
console.log(`PR120_MULTI_ONLY_MP=${best?.stats?.mp ?? 'NA'}`);
console.log(`PR120_MULTI_ONLY_SEARCH_MODE=${diagnostics.requestSearchMode || 'NA'}`);
console.log(`PR120_MULTI_ONLY_NATIVE_COMBINED=${diagnostics.nativeCombinedObjective === true ? 'YES' : 'NO'}`);
console.log(`PR120_MULTI_ONLY_MULTI_SCORES=${multiScores ? JSON.stringify(multiScores) : 'NA'}`);
console.log(`PR120_MULTI_ONLY_DIRECT=${JSON.stringify(diagnostics)}`);
console.log(`PR120_MULTI_ONLY_ITEMS=${(best?.items || []).map((item) => item?.name || item?.id).join(' | ') || 'NA'}`);

if (!best) throw new Error('PR120 Multi-only real catalog probe returned no legal build');
if (diagnostics.requestSearchMode !== 'multi-element-native' || diagnostics.nativeCombinedObjective !== true) {
  throw new Error('PR120 Multi-only probe did not use native combined-objective search');
}
if (Number(best.stats?.ap) !== 12 || Number(best.stats?.mp) !== 6) {
  throw new Error(`PR120 Multi-only probe expected 12/6, got ${best.stats?.ap}/${best.stats?.mp}`);
}
if (Number(best.fm?.exoAp) !== 1 || Number(best.fm?.exoMp) !== 1) {
  throw new Error('PR120 Multi-only probe did not retain the PA/PM exo pair');
}
for (const element of ['earth', 'fire', 'water', 'air']) {
  if (!Number.isFinite(Number(multiScores?.[element]))) {
    throw new Error(`PR120 Multi-only ranking omitted balanced ${element} score`);
  }
}
