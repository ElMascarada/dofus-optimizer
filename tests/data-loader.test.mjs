import test from 'node:test';
import assert from 'node:assert/strict';
import { loadDofusData, loadSpellData, validateDofusSnapshot, validateSpellSnapshot } from '../js/data-loader.js';

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

const spellSnapshot = {
  schemaVersion: 1,
  source: 'dofusdude-release',
  game: 'dofus3',
  language: 'fr',
  gameVersion: { version: '3.6.10.10' },
  characterLevel: 200,
  model: 'direct-fixed-element',
  breeds: [
    { id: 'breed-1', name: 'Féca', spellIds: ['spell-1', 'spell-2'] },
    { id: 'breed-empty', name: 'Vide', spellIds: ['spell-bad'] }
  ],
  spells: [
    { id: 'spell-1', breedId: 'breed-1', name: 'Retour du Bâton', apCost: 3, certified: true, hits: [{ element: 'earth', normal: [20, 24], crit: [24, 28] }] },
    { id: 'spell-2', breedId: 'breed-1', name: 'Non certifié', apCost: 4, certified: false, hits: [{ element: 'fire', normal: [10, 10], crit: [10, 10] }] },
    { id: 'spell-bad', breedId: 'breed-empty', name: 'Sans dégâts', apCost: 2, certified: true, hits: [] }
  ]
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

test('spell loader keeps certified damaging spells and drops empty classes', () => {
  const data = validateSpellSnapshot(spellSnapshot);
  assert.equal(data.spells.length, 1);
  assert.equal(data.spells[0].name, 'Retour du Bâton');
  assert.equal(data.breeds.length, 1);
  assert.deepEqual(data.breeds[0].spellIds, ['spell-1']);
  assert.equal(data.gameVersion.version, '3.6.10.10');
});

test('spell loader rejects empty or malformed spell snapshots', () => {
  assert.throws(() => validateSpellSnapshot({ schemaVersion: 1, breeds: [], spells: [] }), /aucun sort offensif/);
  assert.throws(() => validateSpellSnapshot({ schemaVersion: 2, breeds: [], spells: [] }), /non prise en charge/);
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

test('loadSpellData uses the supplied fetch and validates its payload', async () => {
  const data = await loadSpellData('/spells.json', async () => ({ ok: true, json: async () => spellSnapshot }));
  assert.equal(data.spells.length, 1);
  assert.equal(data.breeds[0].name, 'Féca');
});

test('loadDofusData exposes HTTP loading failures', async () => {
  await assert.rejects(
    () => loadDofusData('/missing.json', async () => ({ ok: false, status: 404 })),
    /404/
  );
});
