import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

import { validateDofusSnapshot } from '../js/data-loader.js';
import { searchEquipmentRequest } from '../js/equipment-search-request.js';
import { buildEquipmentCandidatePools } from '../optimizer/equipment-candidate-policy.js';

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

const cases = [
  { name: 'OWNER_MULTI_SMALL_AUTO', elements: ['multi'], profiles: ['small'], critMode: 'auto' },
  { name: 'OWNER_MULTI_LARGE_AUTO', elements: ['multi'], profiles: ['large'], critMode: 'auto' },
  { name: 'OWNER_MULTI_SMALL_NO_CRIT', elements: ['multi'], profiles: ['small'], critMode: 'no_crit' },
  { name: 'OWNER_MONO_EARTH_LARGE_AUTO', elements: ['earth'], profiles: ['large'], critMode: 'auto' }
];

function normalize(value = '') {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function names(items = []) {
  return items.map((item) => item?.name || item?.id).join(' | ');
}

function namedSlot(result, slot) {
  return (result?.items || []).filter((item) => item?.slot === slot).map((item) => item?.name || item?.id);
}

function containsName(items = [], needle) {
  const query = normalize(needle);
  return items.filter((item) => normalize(item?.name).includes(query));
}

function poolSummary(pool = [], policy, limit = 20) {
  return pool.slice(0, limit).map((item, index) => {
    const ranked = policy.profileItem(item);
    return {
      index,
      name: item?.name || item?.id,
      score: Number(ranked.rankScore || 0),
      ap: Number(item?.stats?.ap || 0),
      mp: Number(item?.stats?.mp || 0),
      power: Number(item?.stats?.power || 0),
      crit: Number(item?.stats?.crit || 0),
      critDamage: Number(item?.stats?.critDamage || 0)
    };
  });
}

const outputs = new Map();
for (const probe of cases) {
  const syntheticOffense = {
    elements: probe.elements,
    profiles: probe.profiles,
    critMode: probe.critMode
  };
  const prefilter = buildEquipmentCandidatePools({
    ...common,
    syntheticOffense
  });

  const companionPool = prefilter.pools?.companion || [];
  const shieldPool = prefilter.pools?.shield || [];
  const dofusPool = prefilter.pools?.dofus || [];
  const sako = containsName(companionPool, 'sako');

  console.log(`${probe.name}_COMPANION_POOL_SIZE=${companionPool.length}`);
  console.log(`${probe.name}_COMPANION_POOL_TOP=${JSON.stringify(poolSummary(companionPool, prefilter.policy, 20))}`);
  console.log(`${probe.name}_SAKO_IN_POOL=${sako.length ? 'YES' : 'NO'}`);
  console.log(`${probe.name}_SAKO_MATCHES=${sako.map((item) => item.name).join(' | ') || 'NA'}`);
  console.log(`${probe.name}_SHIELD_POOL_SIZE=${shieldPool.length}`);
  console.log(`${probe.name}_SHIELD_POOL_TOP=${JSON.stringify(poolSummary(shieldPool, prefilter.policy, 20))}`);
  console.log(`${probe.name}_DOFUS_POOL_SIZE=${dofusPool.length}`);
  console.log(`${probe.name}_DOFUS_POOL_TOP=${JSON.stringify(poolSummary(dofusPool, prefilter.policy, 30))}`);

  const startedAt = performance.now();
  const output = searchEquipmentRequest({
    ...common,
    syntheticOffense
  });
  const elapsedMs = performance.now() - startedAt;
  outputs.set(probe.name, output);

  const best = output.results?.[0] || null;
  const diagnostics = output.diagnostics || {};
  console.log(`${probe.name}_RESULTS=${output.results?.length || 0}`);
  console.log(`${probe.name}_MS=${elapsedMs.toFixed(1)}`);
  console.log(`${probe.name}_DIAGNOSTICS=${JSON.stringify(diagnostics)}`);
  console.log(`${probe.name}_ITEMS=${names(best?.items || []) || 'NA'}`);
  console.log(`${probe.name}_AP=${best?.stats?.ap ?? 'NA'}`);
  console.log(`${probe.name}_MP=${best?.stats?.mp ?? 'NA'}`);
  console.log(`${probe.name}_COMPANION=${namedSlot(best, 'companion').join(' | ') || 'NA'}`);
  console.log(`${probe.name}_SHIELD=${namedSlot(best, 'shield').join(' | ') || 'NA'}`);
  console.log(`${probe.name}_DOFUS=${namedSlot(best, 'dofus').join(' | ') || 'NA'}`);
  console.log(`${probe.name}_MIN_SCORE=${best?.syntheticOffense?.minimumScore ?? 'NA'}`);
  console.log(`${probe.name}_MEAN_SCORE=${best?.syntheticOffense?.meanScore ?? 'NA'}`);
  console.log(`${probe.name}_MULTI_SCORES=${best?.syntheticOffense?.multiElementScores ? JSON.stringify(best.syntheticOffense.multiElementScores) : 'NA'}`);
}

const small = outputs.get('OWNER_MULTI_SMALL_AUTO')?.results?.[0] || null;
const large = outputs.get('OWNER_MULTI_LARGE_AUTO')?.results?.[0] || null;
const noCrit = outputs.get('OWNER_MULTI_SMALL_NO_CRIT')?.results?.[0] || null;
const mono = outputs.get('OWNER_MONO_EARTH_LARGE_AUTO')?.results?.[0] || null;

console.log(`OWNER_SMALL_LARGE_SAME_BUILD=${small?.buildIdentity && small.buildIdentity === large?.buildIdentity ? 'YES' : 'NO'}`);
if (!small) throw new Error('OWNER_MULTI_SMALL_AUTO returned no legal build');
if (!large) throw new Error('OWNER_MULTI_LARGE_AUTO returned no legal build');
if (!mono) throw new Error('OWNER_MONO_EARTH_LARGE_AUTO control returned no legal build');
if (!noCrit) {
  throw new Error('OWNER_MULTI_SMALL_NO_CRIT returned no legal build: feasible-set completeness regression requires first-loss diagnosis');
}
