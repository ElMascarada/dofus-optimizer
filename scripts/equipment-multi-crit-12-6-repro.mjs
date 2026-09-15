import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

import { validateDofusSnapshot } from '../js/data-loader.js';
import { searchEquipmentRequest } from '../js/equipment-search-request.js';
import { buildEquipmentCandidatePools } from '../optimizer/equipment-candidate-policy.js';

const raw = JSON.parse(readFileSync(new URL('../data/normalized/dofus-data.json', import.meta.url), 'utf8'));
const dataset = validateDofusSnapshot(raw);

const fmPolicy = { enabled: true, fmEnabled: true, exoAp: 1, exoMp: 1 };
const request = {
  items: dataset.items,
  sets: dataset.sets,
  constraints: { ap: 12, mp: 6 },
  fmPolicy,
  syntheticOffense: {
    elements: ['multi'],
    profiles: ['large'],
    critMode: 'crit'
  },
  topN: 5,
  searchProfile: 'BALANCED'
};

console.log('CASE=MULTI_LARGE_CRIT_12_6');
console.log(`REQUEST=${JSON.stringify({
  constraints: request.constraints,
  fmPolicy,
  syntheticOffense: request.syntheticOffense,
  topN: request.topN,
  searchProfile: request.searchProfile
})}`);

const prefilterStartedAt = performance.now();
const prefilter = buildEquipmentCandidatePools(request);
console.log(`PREFILTER_MS=${(performance.now() - prefilterStartedAt).toFixed(1)}`);
console.log(`PREFILTER_ITEMS=${prefilter.items?.length || 0}`);
console.log(`PREFILTER_CORES=${prefilter.policy?.setCoreHints?.length || 0}`);
console.log(`PREFILTER_SLOTS=${JSON.stringify(Object.fromEntries(
  Object.entries(prefilter.pools || {}).map(([slot, items]) => [slot, items.length])
))}`);

console.log('SEARCH_BEGIN=1');
const startedAt = performance.now();
const output = searchEquipmentRequest(request);
const elapsedMs = performance.now() - startedAt;
const results = output.results || [];
const best = results[0] || null;

console.log('SEARCH_END=1');
console.log(`RESULTS=${results.length}`);
console.log(`TOTAL_MS=${elapsedMs.toFixed(1)}`);
console.log(`ROUTE=${output.diagnostics?.requestSearchMode || 'NA'}`);
console.log(`PERFORMANCE=${JSON.stringify(output.diagnostics?.performance || null)}`);
console.log(`DIRECT_DIAGNOSTICS=${JSON.stringify({
  requestedAxes: output.diagnostics?.requestedAxes || output.diagnostics?.requestedElements || null,
  architecturesRetained: output.diagnostics?.architecturesRetained ?? null,
  equipmentStatesRetained: output.diagnostics?.equipmentStatesRetained ?? null,
  companionStatesRetained: output.diagnostics?.companionStatesRetained ?? null,
  dofusCandidates: output.diagnostics?.dofusCandidates ?? null,
  contextsWithPackages: output.diagnostics?.contextsWithPackages ?? null,
  evaluated: output.diagnostics?.evaluated ?? null,
  valid: output.diagnostics?.valid ?? null,
  fallbackRequired: output.diagnostics?.fallbackRequired ?? null,
  rejected: output.diagnostics?.rejected || null
})}`);
console.log(`REFINE_DIAGNOSTICS=${JSON.stringify(output.diagnostics?.exactDofusRefine || null)}`);

if (!best) {
  console.log('CLASSIFICATION=FEASIBILITY_OR_SEARCH_LOSS');
  process.exitCode = 2;
} else {
  console.log(`BEST_MIN=${best.syntheticOffense?.minimumScore ?? 'NA'}`);
  console.log(`BEST_MEAN=${best.syntheticOffense?.meanScore ?? 'NA'}`);
  console.log(`BEST_AP=${best.stats?.ap ?? 'NA'}`);
  console.log(`BEST_MP=${best.stats?.mp ?? 'NA'}`);
  console.log(`BEST_CRIT=${best.stats?.crit ?? 'NA'}`);
  console.log(`BEST_DO_CRIT=${best.stats?.critDamage ?? 'NA'}`);
  console.log(`BEST_ITEMS=${JSON.stringify((best.items || []).map((item) => item?.name || item?.id))}`);
  console.log('CLASSIFICATION=COMPLETES');
}
