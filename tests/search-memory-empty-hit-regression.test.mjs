import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SEARCH_ALGORITHM_VERSION,
  normalizeSearchQuery,
  searchFingerprint,
  searchVersionsCompatible
} from '../js/search-memory/search-query.js';
import {
  MemorySearchStore,
  SEARCH_RECORD_VERSION,
  SearchMemoryRepository
} from '../js/search-memory/search-repository.js';

function payload() {
  return {
    classId: 'iop',
    objectiveMode: 'combat',
    combatObjective: {
      element: 'earth',
      turnMode: 't1',
      targetMode: 'single',
      areaTargets: 1,
      allowSupport: true,
      metric: 'total-damage'
    },
    constraints: { ap: 12, mp: 6, initiative: 0 },
    fmPolicy: { structuralExos: false },
    scenario: { requiredApByTurn: {} },
    diversityMode: 'gear',
    searchProfile: 'BALANCED',
    topN: 10
  };
}

function query(searchVersion = SEARCH_ALGORITHM_VERSION) {
  return normalizeSearchQuery({
    payload: payload(),
    versions: { data: 'data-current', rules: 'rules-current', search: searchVersion }
  });
}

function legacyRecord(searchQuery, results) {
  return {
    schemaVersion: SEARCH_RECORD_VERSION,
    fingerprint: searchFingerprint(searchQuery),
    query: searchQuery,
    output: { results, diagnostics: { source: 'legacy' } },
    createdAt: '2026-08-28T10:00:00.000Z',
    updatedAt: '2026-08-28T10:00:00.000Z'
  };
}

test('remember refuses empty exact outputs so they cannot become reusable hits', async () => {
  const store = new MemorySearchStore();
  const repository = new SearchMemoryRepository({ store });
  const current = query();

  const stored = await repository.remember(current, { results: [], diagnostics: {} });

  assert.equal(stored, null);
  assert.equal(await store.get(searchFingerprint(current)), null);
  const recalled = await repository.recallExact(current);
  assert.equal(recalled.hit, false);
  assert.equal(recalled.reason, 'miss');
});

test('remember continues to refuse stoppedEarly outputs even when they are non-empty', async () => {
  const store = new MemorySearchStore();
  const repository = new SearchMemoryRepository({ store });
  const current = query();

  const stored = await repository.remember(current, {
    results: [{ score: 1, items: [] }],
    diagnostics: { stoppedEarly: true }
  });

  assert.equal(stored, null);
  assert.equal(await store.get(searchFingerprint(current)), null);
});

test('a compatible legacy empty record is an explicit empty-results miss', async () => {
  const current = query();
  const repository = new SearchMemoryRepository({
    store: new MemorySearchStore([legacyRecord(current, [])])
  });

  const recalled = await repository.recallExact(current);

  assert.equal(recalled.hit, false);
  assert.equal(recalled.reason, 'empty-results');
  assert.equal(recalled.output, null);
});

test('a compatible non-empty exact record still hits and rehydrates current catalog items', async () => {
  const store = new MemorySearchStore();
  const repository = new SearchMemoryRepository({ store });
  const current = query();
  const canonicalItem = { id: 'hat-current', name: 'Current Hat', slot: 'hat', stats: { earth: 100 } };

  const stored = await repository.remember(current, {
    results: [{ score: 123, stats: { earth: 100 }, items: [canonicalItem] }],
    diagnostics: { visited: 42 }
  });
  const recalled = await repository.recallExact(current, { items: [canonicalItem] });

  assert.ok(stored);
  assert.equal(recalled.hit, true);
  assert.equal(recalled.reason, 'exact');
  assert.equal(recalled.output.results.length, 1);
  assert.equal(recalled.output.results[0].score, 123);
  assert.equal(recalled.output.results[0].items[0], canonicalItem);
});

test('older search algorithm records are incompatible with search algorithm v3', async () => {
  assert.equal(SEARCH_ALGORITHM_VERSION, 'optimizer-search-v2-memory-3');
  const oldQuery = query('optimizer-search-v2-memory-2');
  const currentQuery = query();
  assert.equal(searchVersionsCompatible(oldQuery.versions, currentQuery.versions), false);
  assert.notEqual(searchFingerprint(oldQuery), searchFingerprint(currentQuery));

  const oldItem = { id: 'old-hat', slot: 'hat' };
  const oldRecord = legacyRecord(oldQuery, [{ score: 99, itemIds: [oldItem.id] }]);
  const repository = new SearchMemoryRepository({ store: new MemorySearchStore([oldRecord]) });
  const recalled = await repository.recallExact(currentQuery, { items: [oldItem] });

  assert.equal(recalled.hit, false);
  assert.equal(recalled.reason, 'miss');
});
