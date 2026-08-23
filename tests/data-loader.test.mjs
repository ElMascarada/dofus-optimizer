import test from 'node:test';
import assert from 'node:assert/strict';
import { loadDofusData, validateDofusSnapshot } from '../js/data-loader.js';

const snapshot = {
  schemaVersion: 1,
  source: 'dofusdude',
  game: 'dofus3',
  language: 'fr',
  gameVersion: { version: '3.6.10.10' },
  items: [
    { id: 'item-1', slot: 'hat', certified: true, stats: { power: 80 } },
    { id: 'item-2', slot: 'cape', certified: false, stats: {} }
  ],
  sets: [{ id: 'set-1', bonuses: { 2: { power: 20 } } }]
};

test('browser loader keeps only explicitly certified equipment', () => {
  const data = validateDofusSnapshot(snapshot);
  assert.equal(data.items.length, 1);
  assert.equal(data.items[0].id, 'item-1');
  assert.equal(data.sets.length, 1);
  assert.equal(data.gameVersion.version, '3.6.10.10');
});

test('browser loader rejects malformed snapshots instead of silently falling back to demo data', () => {
  assert.throws(() => validateDofusSnapshot({ schemaVersion: 1, items: [] }), /items et sets/);
  assert.throws(() => validateDofusSnapshot({ schemaVersion: 2, items: [], sets: [] }), /non prise en charge/);
});

test('loadDofusData uses the supplied fetch and validates its payload', async () => {
  const calls = [];
  const data = await loadDofusData('/snapshot.json', async (url, options) => {
    calls.push({ url, options });
    return { ok: true, json: async () => snapshot };
  });
  assert.equal(data.items.length, 1);
  assert.deepEqual(calls, [{ url: '/snapshot.json', options: { cache: 'no-cache' } }]);
});

test('loadDofusData exposes HTTP loading failures', async () => {
  await assert.rejects(
    () => loadDofusData('/missing.json', async () => ({ ok: false, status: 404 })),
    /404/
  );
});
