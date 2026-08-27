import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  createSearchVersions,
  normalizeSearchQuery,
  searchFingerprint,
  searchQueryDistance
} from '../js/search-memory/search-query.js';
import {
  MemorySearchStore,
  SearchMemoryRepository
} from '../js/search-memory/search-repository.js';
import {
  evaluateSearchSeedBuilds,
  seedDescriptorsFromNearby
} from '../js/search-memory/search-seeds.js';
import { mergeSearchOutputs } from '../js/search-memory/search-result-merge.js';

function item(id, slot, stats = {}) {
  return { id, name: id, slot, stats, passives: [], conditions: null, certified: true };
}

function payload(overrides = {}) {
  return {
    classId: 'iop',
    objectiveMode: 'combat',
    combatObjective: {
      element: 'earth', turnMode: 'sum', targetMode: 'single', areaTargets: 3,
      allowSupport: true, metric: 'total-damage'
    },
    constraints: { ap: 12, mp: 6, range: 3, vit: 4000, initiative: 1500, resEarth: 20, resFire: 20, resWater: 20, resAir: 20 },
    fmPolicy: { spellDamagePct: 3, allowCritDamage: true, critDamageAmount: 8, structuralExos: false },
    scenario: { requiredApByTurn: {} },
    diversityMode: 'gear',
    searchProfile: 'BALANCED',
    topN: 10,
    ...overrides
  };
}

const versions = { data: 'data-a', rules: 'rules-a', search: 'search-a' };
const query = (overrides = {}, versionOverrides = {}) => normalizeSearchQuery({
  payload: payload(overrides),
  versions: { ...versions, ...versionOverrides }
});

test('NormalizedSearchQuery produit un fingerprint stable indépendant de l’ordre des clés', () => {
  const first = query();
  const second = query({
    constraints: { resAir: 20, resWater: 20, resFire: 20, resEarth: 20, initiative: 1500, vit: 4000, range: 3, mp: 6, ap: 12 }
  });
  assert.deepEqual(first, second);
  assert.equal(searchFingerprint(first), searchFingerprint(second));
});

test('les versions data/rules/search invalident séparément le fingerprint', () => {
  const base = searchFingerprint(query());
  assert.notEqual(base, searchFingerprint(query({}, { data: 'data-b' })));
  assert.notEqual(base, searchFingerprint(query({}, { rules: 'rules-b' })));
  assert.notEqual(base, searchFingerprint(query({}, { search: 'search-b' })));
});

test('la version data tient compte des catalogues items et sorts', () => {
  const dataset = { gameVersion: { version: '3.6' }, generatedAt: 'now', items: [{ id: 'a' }] };
  const spellData = { gameVersion: { version: '3.6' }, generatedAt: 'now', spells: [{ id: 's1' }] };
  const first = createSearchVersions({ dataset, spellData, rulesVersion: 'r' });
  const second = createSearchVersions({ dataset: { ...dataset, items: [{ id: 'b' }] }, spellData, rulesVersion: 'r' });
  assert.notEqual(first.data, second.data);
});

test('le cache exact stocke les résultats ID-only puis réhydrate depuis le catalogue courant sans Worker', async () => {
  const store = new MemorySearchStore();
  const repository = new SearchMemoryRepository({ store, now: () => '2026-08-27T10:00:00Z' });
  const canonical = item('hat-current', 'hat', { earth: 100 });
  await repository.remember(query(), {
    results: [{ score: 123, stats: { earth: 100 }, items: [canonical] }],
    diagnostics: { visited: 9 }
  });
  const raw = await store.get(searchFingerprint(query()));
  assert.deepEqual(raw.output.results[0].itemIds, ['hat-current']);
  assert.equal(raw.output.results[0].items, undefined);

  const originalWorker = globalThis.Worker;
  let workerCalls = 0;
  globalThis.Worker = class { constructor() { workerCalls++; } };
  try {
    const recalled = await repository.recallExact(query(), { items: [canonical] });
    assert.equal(recalled.hit, true);
    assert.equal(recalled.output.results[0].items[0], canonical);
    assert.equal(workerCalls, 0);
  } finally {
    if (originalWorker === undefined) delete globalThis.Worker;
    else globalThis.Worker = originalWorker;
  }
});

test('un cache exact dont un item a disparu est refusé proprement', async () => {
  const repository = new SearchMemoryRepository({ store: new MemorySearchStore() });
  await repository.remember(query(), { results: [{ score: 1, items: [item('gone', 'hat')] }], diagnostics: {} });
  const recalled = await repository.recallExact(query(), { items: [] });
  assert.equal(recalled.hit, false);
  assert.equal(recalled.reason, 'missing-items');
  assert.deepEqual(recalled.missingItemIds, ['gone']);
});

test('les requêtes proches restent strictement compatibles en classe/élément/mode/versions', async () => {
  const repository = new SearchMemoryRepository({ store: new MemorySearchStore(), now: () => '2026-08-27T10:01:00Z' });
  await repository.remember(query(), { results: [{ score: 1, items: [item('a', 'hat')] }], diagnostics: {} });
  const close = query({ constraints: { ...payload().constraints, initiative: 1700 } });
  assert.ok(searchQueryDistance(query(), close) > 0);
  assert.equal((await repository.findNearby(close)).length, 1);
  assert.equal((await repository.findNearby(query({ combatObjective: { ...payload().combatObjective, element: 'fire' } }))).length, 0);
  assert.equal((await repository.findNearby(query({}, { rules: 'rules-new' }))).length, 0);
});

function fullBuildItems() {
  return [
    item('hat', 'hat'), item('cape', 'cape'), item('amulet', 'amulet'),
    item('ring-1', 'ring'), item('ring-2', 'ring'), item('belt', 'belt'),
    item('boots', 'boots'), item('weapon', 'weapon'), item('shield', 'shield'),
    item('companion', 'companion'),
    ...Array.from({ length: 6 }, (_, index) => item(`dofus-${index + 1}`, 'dofus'))
  ];
}

test('les meilleurs builds proches deviennent des seeds ID-only dédupliqués', () => {
  const ids = fullBuildItems().map((entry) => entry.id);
  const nearby = [{
    distance: 0.1,
    record: {
      fingerprint: 'source-a',
      output: { results: [{ score: 100, itemIds: ids }, { score: 90, itemIds: [...ids].reverse() }] }
    }
  }];
  const seeds = seedDescriptorsFromNearby(nearby, { maxBuilds: 8 });
  assert.equal(seeds.length, 1);
  assert.deepEqual(seeds[0].itemIds, ids);
  assert.equal(seeds[0].sourceFingerprint, 'source-a');
});

test('chaque seed est réhydraté avec les items courants puis repasse par l’évaluateur canonique', () => {
  const currentItems = fullBuildItems().map((entry) => ({ ...entry, revision: 'current' }));
  const ids = currentItems.map((entry) => entry.id);
  let evaluatorCalls = 0;
  const evaluated = evaluateSearchSeedBuilds({
    seedBuilds: [{ itemIds: ids, sourceFingerprint: 'nearby' }],
    items: currentItems,
    sets: [],
    constraints: { initiative: 2000 },
    fmPolicy: { structuralExos: false },
    turnMode: 't1',
    evaluate(args) {
      evaluatorCalls++;
      assert.ok(args.items.every((entry) => entry.revision === 'current'));
      assert.equal(args.constraints.initiative, 2000);
      return { result: { score: 42, items: args.items, stats: { initiative: 2100 } } };
    }
  });
  assert.equal(evaluatorCalls, 1);
  assert.equal(evaluated.results.length, 1);
  assert.equal(evaluated.results[0].searchOrigin, 'seed');
  assert.equal(evaluated.diagnostics.valid, 1);
});

test('un seed incomplet ou disparu ne peut pas être servi comme candidat', () => {
  const currentItems = fullBuildItems();
  const evaluated = evaluateSearchSeedBuilds({
    seedBuilds: [{ itemIds: currentItems.map((entry) => entry.id).slice(0, -1) }],
    items: currentItems,
    evaluate: () => { throw new Error('ne doit pas être appelé'); }
  });
  assert.equal(evaluated.results.length, 0);
  assert.equal(evaluated.diagnostics.rejected.shape, 1);
});

test('la fusion ajoute les seeds sans supprimer la voie libre quand le topN le permet', () => {
  const free = { score: 100, items: [item('free', 'hat')] };
  const seed = { score: 110, items: [item('seed', 'hat')] };
  const merged = mergeSearchOutputs(
    { results: [free], diagnostics: { visited: 10 } },
    { results: [seed], diagnostics: { seedEvaluation: { attempted: 1, valid: 1, rejected: {} } } },
    { topN: 10, diversityMode: 'score', fingerprint: 'fp', nearbyRecords: 1 }
  );
  assert.deepEqual(merged.results.map((entry) => entry.items[0].id), ['seed', 'free']);
  assert.equal(merged.diagnostics.searchMemory.seedsValid, 1);
  assert.equal(merged.diagnostics.searchMemory.cacheHit, false);
});

test('le parcours UI vérifie le cache avant de créer le Worker lourd et utilise un Worker seed séparé', async () => {
  const source = await readFile(new URL('../js/optimizer-v2-app.js', import.meta.url), 'utf8');
  assert.ok(source.indexOf('recallExact') < source.indexOf("new Worker(new URL('./optimizer-worker.js'"));
  assert.match(source, /findNearby/);
  assert.match(source, /seed-worker\.js/);
  assert.match(source, /searchMemory\.remember/);
  assert.match(source, /rulesVersion: APP_VERSION/);
});
