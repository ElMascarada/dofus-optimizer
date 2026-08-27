import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  createSearchVersionContext,
  normalizeSearchQuery,
  searchFingerprint,
  searchQuerySimilarity,
  searchVersionsAreCompatible
} from '../js/search-query.js';
import {
  MemorySearchStore,
  SearchRepository,
  seedBuildsFromNearby
} from '../js/search-repository.js';
import { evaluateSearchSeeds } from '../js/search-seeds.js';

function item(id, slot, stats = {}) {
  return {
    id,
    name: id,
    slot,
    level: 200,
    stats,
    passives: [],
    conditions: null,
    certified: true
  };
}

function completeItems({ initiative = 0 } = {}) {
  return [
    item('hat', 'hat', { initiative }),
    item('cape', 'cape', { ap: 1 }),
    item('amulet', 'amulet', { ap: 1 }),
    item('ring-a', 'ring'),
    item('ring-b', 'ring'),
    item('belt', 'belt'),
    item('boots', 'boots', { mp: 1 }),
    item('weapon', 'weapon', { ap: 1 }),
    item('shield', 'shield'),
    item('companion', 'companion'),
    item('dofus-ap', 'dofus', { ap: 1 }),
    item('dofus-mp', 'dofus', { mp: 1 }),
    item('dofus-3', 'dofus'),
    item('dofus-4', 'dofus'),
    item('dofus-5', 'dofus'),
    item('dofus-6', 'dofus')
  ];
}

const versions = Object.freeze({
  dataVersion: 'data-v1',
  rulesVersion: 'rules-v1',
  searchVersion: 'search-v1'
});

function payload(overrides = {}) {
  return {
    classId: 'iop',
    combatObjective: {
      element: 'earth',
      turnMode: 'sum',
      targetMode: 'single',
      areaTargets: 3,
      allowSupport: true,
      metric: 'total-damage'
    },
    constraints: {
      ap: 12, mp: 6, range: 0, vit: 0, initiative: 0,
      resEarth: 0, resFire: 0, resWater: 0, resAir: 0
    },
    fmPolicy: {
      spellDamagePct: 3,
      allowCritDamage: true,
      critDamageAmount: 8,
      structuralExos: false
    },
    scenario: { requiredApByTurn: {} },
    diversityMode: 'gear',
    searchProfile: 'BALANCED',
    turnMode: 'sum',
    topN: 10,
    ...overrides
  };
}

function query(overrides = {}, versionOverrides = {}) {
  return normalizeSearchQuery(payload(overrides), { ...versions, ...versionOverrides });
}

test('NormalizedSearchQuery produit un fingerprint stable indépendant de l’ordre des objets', () => {
  const first = query({ constraints: { ap: 12, mp: 6, vit: 4200, initiative: 1800 } });
  const second = query({ constraints: { initiative: 1800, vit: 4200, mp: 6, ap: 12 } });
  assert.deepEqual(first, second);
  assert.equal(searchFingerprint(first), searchFingerprint(second));
  assert.equal(first.classId, 'iop');
  assert.equal(first.element, 'earth');
});

test('les versions data, rules et search participent toutes à la compatibilité et au fingerprint', () => {
  const base = query();
  for (const [key, value] of [['dataVersion', 'data-v2'], ['rulesVersion', 'rules-v2'], ['searchVersion', 'search-v2']]) {
    const changed = query({}, { [key]: value });
    assert.equal(searchVersionsAreCompatible(base, changed), false, key);
    assert.notEqual(searchFingerprint(base), searchFingerprint(changed), key);
  }
});

test('la version data combine les snapshots équipements et sorts', () => {
  const context = createSearchVersionContext({
    dataset: { schemaVersion: 1, gameVersion: { version: '3.6' }, generatedAt: 'items-a' },
    spellData: { schemaVersion: 1, gameVersion: { version: '3.6' }, generatedAt: 'spells-a' },
    rulesVersion: 'rules',
    searchVersion: 'search'
  });
  const changed = createSearchVersionContext({
    dataset: { schemaVersion: 1, gameVersion: { version: '3.6' }, generatedAt: 'items-a' },
    spellData: { schemaVersion: 1, gameVersion: { version: '3.6' }, generatedAt: 'spells-b' },
    rulesVersion: 'rules',
    searchVersion: 'search'
  });
  assert.notEqual(context.dataVersion, changed.dataVersion);
});

test('SearchRepository stocke les résultats par IDs et sert un hit exact réhydraté', async () => {
  const items = completeItems();
  const store = new MemorySearchStore();
  const repository = new SearchRepository({
    store,
    now: () => '2026-08-27T10:00:00Z'
  });
  const normalized = query();
  await repository.save(normalized, {
    results: [{ items, score: 1234, perTurn: { 1: 400, 2: 410, 3: 424 }, stats: { ap: 12, mp: 6 } }],
    diagnostics: { visited: 42 }
  });

  const raw = await store.get(searchFingerprint(normalized));
  assert.equal(raw.output.results[0].items, undefined);
  assert.equal(raw.output.results[0].itemIds.length, 16);

  const exact = await repository.findExact(normalized, { items });
  assert.equal(exact.hit, true);
  assert.equal(exact.output.results[0].items.length, 16);
  assert.equal(exact.output.results[0].items[0].id, 'hat');
  assert.equal(exact.output.diagnostics.visited, 42);
});

test('un cache avec item disparu n’est jamais servi', async () => {
  const items = completeItems();
  const repository = new SearchRepository({ store: new MemorySearchStore() });
  const normalized = query();
  await repository.save(normalized, { results: [{ items, score: 1 }], diagnostics: {} });
  const exact = await repository.findExact(normalized, { items: items.filter((entry) => entry.id !== 'hat') });
  assert.equal(exact.hit, false);
  assert.equal(exact.reason, 'missing-item');
});

test('les recherches proches restent même classe/élément et versions compatibles', async () => {
  const items = completeItems();
  const repository = new SearchRepository({ store: new MemorySearchStore() });
  const base = query({ constraints: { ap: 12, mp: 6, vit: 4000 } });
  await repository.save(base, { results: [{ items, score: 100 }], diagnostics: {} });

  const close = query({ constraints: { ap: 12, mp: 6, vit: 4300 } });
  assert.ok(searchQuerySimilarity(close, base) > 0.5);
  assert.equal((await repository.findNearby(close)).length, 1);

  const otherClass = query({ classId: 'cra', constraints: { ap: 12, mp: 6, vit: 4300 } });
  assert.equal(searchQuerySimilarity(otherClass, base), 0);
  assert.equal((await repository.findNearby(otherClass)).length, 0);

  const stale = query({ constraints: { ap: 12, mp: 6, vit: 4300 } }, { rulesVersion: 'rules-v2' });
  assert.equal((await repository.findNearby(stale)).length, 0);
});

test('les meilleurs résultats proches deviennent des seeds dédupliqués', async () => {
  const items = completeItems();
  const repository = new SearchRepository({ store: new MemorySearchStore() });
  const first = query({ constraints: { ap: 12, mp: 6, vit: 3900 } });
  const second = query({ constraints: { ap: 12, mp: 6, vit: 4100 } });
  await repository.save(first, { results: [{ items, score: 100 }], diagnostics: {} });
  await repository.save(second, { results: [{ items, score: 120 }], diagnostics: {} });
  const nearby = await repository.findNearby(query({ constraints: { ap: 12, mp: 6, vit: 4000 } }));
  const seeds = seedBuildsFromNearby(nearby, { limit: 10 });
  assert.equal(seeds.length, 1);
  assert.equal(seeds[0].itemIds.length, 16);
  assert.ok(seeds[0].sourceScore >= 100);
});

test('tout seed est reconstruit puis réévalué par CompleteBuildEvaluator avec les contraintes courantes', () => {
  const items = completeItems({ initiative: 1500 });
  const seed = { itemIds: items.map((entry) => entry.id), sourceFingerprint: 'old', sourceScore: 99999, similarity: 0.9 };
  const basePayload = {
    items,
    sets: [],
    selections: [],
    constraints: { ap: 12, mp: 6, initiative: 1400 },
    fmPolicy: { spellDamagePct: 0, allowCritDamage: false, structuralExos: false },
    turnMode: 't1',
    scenario: {},
    requiredItemIds: []
  };
  const valid = evaluateSearchSeeds({ seedBuilds: [seed], payload: basePayload });
  assert.equal(valid.diagnostics.valid, 1);
  assert.equal(valid.results[0].searchOrigin, 'seed');
  assert.notEqual(valid.results[0].score, seed.sourceScore);

  const invalid = evaluateSearchSeeds({
    seedBuilds: [seed],
    payload: { ...basePayload, constraints: { ap: 12, mp: 6, initiative: 2000 } }
  });
  assert.equal(invalid.diagnostics.valid, 0);
  assert.equal(invalid.diagnostics.rejected.constraint, 1);
});

test('un seed incomplet ou avec item absent est rejeté avant fusion', () => {
  const items = completeItems();
  const missing = evaluateSearchSeeds({
    seedBuilds: [{ itemIds: [...items.map((entry) => entry.id), 'gone'] }],
    payload: { items, sets: [], selections: [], constraints: {}, fmPolicy: {}, turnMode: 't1', scenario: {} }
  });
  assert.equal(missing.diagnostics.valid, 0);
  assert.equal(missing.diagnostics.rejected['missing-item'], 1);

  const incomplete = evaluateSearchSeeds({
    seedBuilds: [{ itemIds: items.slice(0, 5).map((entry) => entry.id) }],
    payload: { items, sets: [], selections: [], constraints: {}, fmPolicy: {}, turnMode: 't1', scenario: {} }
  });
  assert.equal(incomplete.diagnostics.valid, 0);
  assert.equal(incomplete.diagnostics.rejected['incomplete-shape'], 1);
});

test('le parcours exact cache évite la création du Worker et la voie libre reste exécutée avant fusion seed', async () => {
  const app = await readFile(new URL('../js/optimizer-v2-app.js', import.meta.url), 'utf8');
  const worker = await readFile(new URL('../js/optimizer-worker.js', import.meta.url), 'utf8');
  assert.ok(app.indexOf('findExact(query') < app.indexOf("new Worker(new URL('./optimizer-worker.js'"));
  assert.match(app, /if \(exact\.hit\)[\s\S]*aucun recalcul lourd/);
  assert.ok(worker.indexOf('searchArchitecturesV2({') < worker.indexOf('evaluateSearchSeeds({'));
  assert.match(worker, /freeSearchCandidates/);
  assert.match(worker, /searchMemorySeeds/);
});
