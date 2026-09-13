import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

import { validateDofusSnapshot } from '../js/data-loader.js';
import { searchEquipmentRequest } from '../js/equipment-search-request.js';

const profile = String(process.env.PROFILE || 'large').trim().toLowerCase();
const critMode = String(process.env.CRIT_MODE || 'crit').trim().toLowerCase();
if (!['small', 'medium', 'large'].includes(profile)) {
  throw new RangeError(`PROFILE must be small, medium or large; got ${profile}`);
}
if (!['auto', 'crit', 'no_crit'].includes(critMode)) {
  throw new RangeError(`CRIT_MODE must be auto, crit or no_crit; got ${critMode}`);
}

const raw = JSON.parse(readFileSync(new URL('../data/normalized/dofus-data.json', import.meta.url), 'utf8'));
const dataset = validateDofusSnapshot(raw);
const startedAt = performance.now();
const output = searchEquipmentRequest({
  items: dataset.items,
  sets: dataset.sets,
  constraints: { ap: 12, mp: 6 },
  fmPolicy: { enabled: true, fmEnabled: true, exoAp: 1, exoMp: 1 },
  syntheticOffense: { elements: ['multi'], profiles: [profile], critMode },
  requiredItemIds: [],
  topN: 50,
  searchProfile: 'BALANCED'
});
const elapsedMs = performance.now() - startedAt;
const results = output.results || [];

function hasName(result, name) {
  return (result?.items || []).some((item) => String(item?.name || '') === name);
}

function companionName(result) {
  return (result?.items || []).find((item) => item?.slot === 'companion')?.name || 'NONE';
}

console.log(`PROFILE=${profile}`);
console.log(`CRIT_MODE=${critMode}`);
console.log(`PUBLIC_REQUEST_MS=${elapsedMs.toFixed(1)}`);
console.log(`PUBLIC_RESULTS=${results.length}`);
console.log(`PUBLIC_DIAGNOSTICS=${JSON.stringify(output.diagnostics || {})}`);

for (let index = 0; index < Math.min(results.length, 20); index++) {
  const result = results[index];
  const probe = result?.syntheticOffense?.requestedProbes?.[0] || null;
  console.log(JSON.stringify({
    rank: index + 1,
    score: result?.syntheticOffense?.minimumScore ?? result?.score ?? null,
    rawCrit: result?.stats?.crit ?? null,
    effectiveCritChancePct: probe?.effectiveCritChancePct ?? null,
    companion: companionName(result),
    turquoise: hasName(result, 'Dofus Turquoise'),
    dofus: (result?.items || []).filter((item) => item?.slot === 'dofus').map((item) => item?.name || item?.id)
  }));
}

if (!results.length) throw new Error('Public combined Multi diagnostic returned no result');
