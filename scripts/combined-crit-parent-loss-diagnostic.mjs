import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

import { validateDofusSnapshot } from '../js/data-loader.js';
import { searchCombinedSetCoreEquipment } from '../optimizer/combined-set-core-search.js';

const profile = String(process.env.PROFILE || 'medium').trim().toLowerCase();
if (!['small', 'medium', 'large'].includes(profile)) {
  throw new RangeError(`PROFILE must be small, medium or large; got ${profile}`);
}

const raw = JSON.parse(readFileSync(new URL('../data/normalized/dofus-data.json', import.meta.url), 'utf8'));
const dataset = validateDofusSnapshot(raw);
const constraints = { ap: 12, mp: 6 };
const fmPolicy = { enabled: true, fmEnabled: true, exoAp: 1, exoMp: 1 };
const syntheticOffense = { elements: ['multi'], profiles: [profile], critMode: 'auto' };

const startedAt = performance.now();
const direct = searchCombinedSetCoreEquipment({
  items: dataset.items,
  sets: dataset.sets,
  constraints,
  fmPolicy,
  syntheticOffense,
  topN: 160,
  searchProfile: 'BALANCED'
});
const elapsedMs = performance.now() - startedAt;

const results = direct.results || [];
const baseSeen = new Set();
let uniqueBaseRank = 0;
let firstKokulteBaseRank = null;
let firstKokulteResultRank = null;
let kokulteResults = 0;
let turquoiseResults = 0;
let kokulteTurquoiseResults = 0;

function hasName(result, name) {
  return (result?.items || []).some((item) => String(item?.name || '') === name);
}

function companionName(result) {
  return (result?.items || []).find((item) => item?.slot === 'companion')?.name || 'NONE';
}

function baseKey(result) {
  return (result?.items || [])
    .filter((item) => item?.slot !== 'dofus')
    .map((item) => String(item?.id ?? ''))
    .sort()
    .join('|');
}

for (let index = 0; index < results.length; index++) {
  const result = results[index];
  const rank = index + 1;
  const kokulte = hasName(result, 'Kokulte');
  const turquoise = hasName(result, 'Dofus Turquoise');
  if (kokulte) {
    kokulteResults++;
    if (firstKokulteResultRank == null) firstKokulteResultRank = rank;
  }
  if (turquoise) turquoiseResults++;
  if (kokulte && turquoise) kokulteTurquoiseResults++;

  const key = baseKey(result);
  if (!baseSeen.has(key)) {
    baseSeen.add(key);
    uniqueBaseRank++;
    if (kokulte && firstKokulteBaseRank == null) firstKokulteBaseRank = uniqueBaseRank;
  }
}

console.log(`PROFILE=${profile}`);
console.log(`DIRECT_MS=${elapsedMs.toFixed(1)}`);
console.log(`DIRECT_RESULTS=${results.length}`);
console.log(`UNIQUE_NON_DOFUS_BASES=${baseSeen.size}`);
console.log(`KOKULTE_DIRECT_RESULTS=${kokulteResults}`);
console.log(`TURQUOISE_DIRECT_RESULTS=${turquoiseResults}`);
console.log(`KOKULTE_TURQUOISE_DIRECT_RESULTS=${kokulteTurquoiseResults}`);
console.log(`FIRST_KOKULTE_RESULT_RANK=${firstKokulteResultRank ?? 'NONE'}`);
console.log(`FIRST_KOKULTE_BASE_RANK=${firstKokulteBaseRank ?? 'NONE'}`);
console.log(`EXACT_DOFUS_BASE_CONTEXT_LIMIT=30`);
console.log(`KOKULTE_REACHES_EXACT_DOFUS_CONTEXT=${firstKokulteBaseRank != null && firstKokulteBaseRank <= 30 ? 'YES' : 'NO'}`);
console.log(`DIRECT_DIAGNOSTICS=${JSON.stringify(direct.diagnostics || {})}`);

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

if (!results.length) throw new Error('Combined Multi diagnostic returned no result');
