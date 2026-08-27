import { performance } from 'node:perf_hooks';

import { normalizeSearchQuery } from '../js/search-query.js';
import {
  MemorySearchStore,
  SearchRepository,
  seedBuildsFromNearby
} from '../js/search-repository.js';

function item(id, slot) {
  return { id, name: id, slot, stats: {}, certified: true };
}

function buildItems(seed) {
  return [
    item(`hat-${seed}`, 'hat'),
    item(`cape-${seed}`, 'cape'),
    item(`amulet-${seed}`, 'amulet'),
    item(`ring-a-${seed}`, 'ring'),
    item(`ring-b-${seed}`, 'ring'),
    item(`belt-${seed}`, 'belt'),
    item(`boots-${seed}`, 'boots'),
    item(`weapon-${seed}`, 'weapon'),
    item(`shield-${seed}`, 'shield'),
    item(`companion-${seed}`, 'companion'),
    ...Array.from({ length: 6 }, (_, index) => item(`dofus-${seed}-${index}`, 'dofus'))
  ];
}

const versions = { dataVersion: 'bench-data', rulesVersion: 'bench-rules', searchVersion: 'bench-search' };
function query(vit, initiative = 0) {
  return normalizeSearchQuery({
    classId: 'iop',
    combatObjective: { element: 'earth', turnMode: 'sum', targetMode: 'single', areaTargets: 3, allowSupport: true, metric: 'total-damage' },
    constraints: { ap: 12, mp: 6, vit, initiative },
    fmPolicy: { spellDamagePct: 3, allowCritDamage: true, critDamageAmount: 8, structuralExos: false },
    scenario: { requiredApByTurn: {} },
    diversityMode: 'gear',
    searchProfile: 'BALANCED',
    turnMode: 'sum',
    topN: 10
  }, versions);
}

function percentile(values, fraction) {
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * fraction))] || 0;
}

const store = new MemorySearchStore();
const repository = new SearchRepository({ store, maxRecords: 60 });
const catalog = [];
for (let index = 0; index < 60; index++) {
  const items = buildItems(index);
  catalog.push(...items);
  await repository.save(query(3500 + index * 25, index * 25), {
    results: [{ items, score: 1000 + index, perTurn: { 1: 300, 2: 330, 3: 370 }, stats: { ap: 12, mp: 6 } }],
    diagnostics: { visited: 1000 + index }
  });
}

const itemById = new Map(catalog.map((entry) => [entry.id, entry]));
const uniqueCatalog = [...itemById.values()];
const exactQuery = query(3500 + 59 * 25, 59 * 25);
const nearQuery = query(3500 + 58 * 25 + 10, 58 * 25 + 10);
const exactTimes = [];
const nearbyTimes = [];

for (let index = 0; index < 250; index++) {
  let started = performance.now();
  const exact = await repository.findExact(exactQuery, { items: uniqueCatalog });
  exactTimes.push(performance.now() - started);
  if (!exact.hit) throw new Error('Exact search-memory benchmark unexpectedly missed.');

  started = performance.now();
  const nearby = await repository.findNearby(nearQuery, { limit: 4 });
  const seeds = seedBuildsFromNearby(nearby, { limit: 24 });
  nearbyTimes.push(performance.now() - started);
  if (!seeds.length) throw new Error('Nearby search-memory benchmark produced no seeds.');
}

const report = {
  records: (await store.getAll()).length,
  exact: {
    medianMs: percentile(exactTimes, 0.5),
    p95Ms: percentile(exactTimes, 0.95),
    maxMs: Math.max(...exactTimes)
  },
  nearby: {
    medianMs: percentile(nearbyTimes, 0.5),
    p95Ms: percentile(nearbyTimes, 0.95),
    maxMs: Math.max(...nearbyTimes)
  }
};

if (report.records !== 60) throw new Error(`Search memory retention regression: ${report.records} records.`);
if (report.exact.p95Ms > 10) throw new Error(`Exact cache lookup too slow: p95=${report.exact.p95Ms.toFixed(3)}ms.`);
if (report.nearby.p95Ms > 20) throw new Error(`Nearby seed lookup too slow: p95=${report.nearby.p95Ms.toFixed(3)}ms.`);

console.log('SEARCH_MEMORY_BENCHMARK_BEGIN');
console.log(JSON.stringify(report, null, 2));
console.log('SEARCH_MEMORY_BENCHMARK_END');
