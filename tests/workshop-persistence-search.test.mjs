import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createWorkshopBuild,
  equipWorkshopItem
} from '../js/workshop/workshop-build.js';
import {
  WORKSHOP_BUILD_SCHEMA_VERSION,
  migrateWorkshopBuildSnapshot,
  rehydrateWorkshopBuild,
  serializeWorkshopBuild
} from '../js/workshop/build-serialization.js';
import {
  BuildRepository,
  MemoryBuildStore,
  WORKSHOP_BUILD_RECORD_VERSION,
  WORKSHOP_DRAFT_ID,
  migrateBuildRecord
} from '../js/workshop/build-repository.js';
import { createWorkshopAutosave } from '../js/workshop/workshop-autosave.js';
import { createItemSearchIndex, parseSmartItemQuery } from '../js/workshop/item-search.js';

function item(id, slot, stats = {}, extra = {}) {
  return { id, name: id, slot, level: 200, stats, passives: [], conditions: null, certified: true, ...extra };
}

const catalog = [
  item('hat-earth-ini', 'hat', { earth: 120, initiative: 1200 }),
  item('cape-water-distance', 'cape', { water: 110, rangedDamagePct: 12 }),
  item('boots-vita-res', 'boots', { vit: 500, resEarth: 12, resFire: 10, resWater: 8, resAir: 9 }),
  item('ring-ap-multi', 'ring', { ap: 1, power: 80 }),
  item('ring-multi-docrit', 'ring', { power: 70, critDamage: 35 }),
  item('ring-plain', 'ring', { vit: 300 })
];

function buildWithTwoItems() {
  let build = createWorkshopBuild({ classId: 'breed-8' });
  build = equipWorkshopItem(build, 'hat', catalog[0]).build;
  build = equipWorkshopItem(build, 'ring-1', catalog[3]).build;
  return build;
}

test('la sérialisation Atelier stocke uniquement les IDs canoniques des items', () => {
  const build = buildWithTwoItems();
  const snapshot = serializeWorkshopBuild(build, { dataVersion: '3.6-test' });
  assert.equal(snapshot.schemaVersion, WORKSHOP_BUILD_SCHEMA_VERSION);
  assert.equal(snapshot.dataVersion, '3.6-test');
  assert.deepEqual(snapshot.equipmentBySlot, {
    hat: 'hat-earth-ini',
    'ring-1': 'ring-ap-multi'
  });
  assert.equal(typeof snapshot.equipmentBySlot.hat, 'string');
});

test('un snapshot v0 avec objets item migre vers le schéma ID-only', () => {
  const migrated = migrateWorkshopBuildSnapshot({
    classId: 'breed-8',
    equipmentBySlot: {
      hat: catalog[0],
      'ring-1': { id: 'ring-ap-multi' }
    }
  });
  assert.equal(migrated.schemaVersion, WORKSHOP_BUILD_SCHEMA_VERSION);
  assert.deepEqual(migrated.equipmentBySlot, {
    hat: 'hat-earth-ini',
    'ring-1': 'ring-ap-multi'
  });
});

test('la reconstruction résout les IDs contre le catalogue courant et signale un item disparu', () => {
  const snapshot = serializeWorkshopBuild(buildWithTwoItems(), { dataVersion: 'old' });
  const hydrated = rehydrateWorkshopBuild(snapshot, { items: catalog.filter((entry) => entry.id !== 'ring-ap-multi') });
  assert.equal(hydrated.build.equipmentBySlot.hat.id, 'hat-earth-ini');
  assert.equal(hydrated.build.equipmentBySlot['ring-1'], undefined);
  assert.deepEqual(hydrated.missingItems, [{ slotKey: 'ring-1', itemId: 'ring-ap-multi' }]);
  assert.equal(hydrated.degraded, true);
});

test('la reconstruction refuse proprement un item devenu incompatible avec son slot', () => {
  const snapshot = {
    schemaVersion: WORKSHOP_BUILD_SCHEMA_VERSION,
    classId: null,
    equipmentBySlot: { hat: 'moved-item' },
    fmPolicy: {},
    selectedSpells: []
  };
  const hydrated = rehydrateWorkshopBuild(snapshot, { items: [item('moved-item', 'cape')] });
  assert.equal(hydrated.build.equipmentBySlot.hat, undefined);
  assert.equal(hydrated.incompatibleItems[0].reason, 'slot-mismatch');
});

test('BuildRepository couvre save/list/rename/duplicate/delete avec versions stables', async () => {
  let tick = 0;
  let id = 0;
  const repository = new BuildRepository({
    store: new MemoryBuildStore(),
    now: () => `2026-08-27T06:30:${String(tick++).padStart(2, '0')}Z`,
    idFactory: () => `build-${++id}`
  });
  const saved = await repository.save(buildWithTwoItems(), { name: 'Terre test', dataVersion: 'v1' });
  assert.equal(saved.schemaVersion, WORKSHOP_BUILD_RECORD_VERSION);
  assert.equal(saved.id, 'build-1');
  assert.equal(saved.name, 'Terre test');
  assert.equal((await repository.list()).length, 1);

  const renamed = await repository.rename(saved.id, 'Terre propre');
  assert.equal(renamed.name, 'Terre propre');

  const duplicate = await repository.duplicate(saved.id);
  assert.equal(duplicate.id, 'build-2');
  assert.equal(duplicate.name, 'Terre propre — copie');
  assert.equal((await repository.list()).length, 2);

  assert.equal(await repository.delete(saved.id), true);
  assert.equal(await repository.get(saved.id), null);
  assert.equal((await repository.list()).length, 1);
});

test('les anciens records de sauvegarde migrent vers le record v1', () => {
  const migrated = migrateBuildRecord({
    id: 'legacy',
    name: 'Legacy',
    build: { equipmentBySlot: { hat: catalog[0] } },
    updatedAt: '2026-08-01T00:00:00Z'
  });
  assert.equal(migrated.schemaVersion, WORKSHOP_BUILD_RECORD_VERSION);
  assert.equal(migrated.snapshot.equipmentBySlot.hat, 'hat-earth-ini');
});

test('le brouillon autosave est séparé de la bibliothèque et restaurable', async () => {
  const repository = new BuildRepository({
    store: new MemoryBuildStore(),
    now: () => '2026-08-27T06:40:00Z',
    idFactory: () => 'unused'
  });
  let scheduled = null;
  const autosave = createWorkshopAutosave(repository, {
    dataVersion: 'v1',
    schedule: (callback) => { scheduled = callback; return 7; },
    cancel: () => {}
  });
  autosave.queue(buildWithTwoItems());
  assert.equal(typeof scheduled, 'function');
  scheduled();
  await autosave.flush();

  const draft = await repository.loadDraft();
  assert.equal(draft.id, WORKSHOP_DRAFT_ID);
  assert.equal((await repository.list()).length, 0);
  const restored = await autosave.restore({ items: catalog, currentDataVersion: 'v1' });
  assert.equal(restored.build.equipmentBySlot.hat.id, 'hat-earth-ini');
  assert.equal(restored.staleDataVersion, false);
});

test('un build sauvegardé sur une ancienne version de données est signalé sans être rejeté', async () => {
  const repository = new BuildRepository({ store: new MemoryBuildStore(), idFactory: () => 'build-1' });
  const record = await repository.save(buildWithTwoItems(), { name: 'Old', dataVersion: 'old-version' });
  const hydrated = repository.hydrate(record, { items: catalog, currentDataVersion: 'new-version' });
  assert.equal(hydrated.staleDataVersion, true);
  assert.equal(hydrated.build.equipmentBySlot.hat.id, 'hat-earth-ini');
});

test('le parseur Smart Item Search reconnait le vocabulaire cible', () => {
  assert.deepEqual(parseSmartItemQuery('multi do crit').criteria, ['crit-damage', 'multi']);
  assert.deepEqual(parseSmartItemQuery('terre ini').criteria, ['earth', 'initiative']);
  assert.deepEqual(parseSmartItemQuery('eau distance').criteria, ['water', 'ranged']);
  const plan = parseSmartItemQuery('anneau PA multi');
  assert.equal(plan.slot, 'ring');
  assert.deepEqual(plan.criteria, ['ap', 'multi']);
});

test('Smart Item Search classe les requêtes métier demandées avec raisons explicites', () => {
  const index = createItemSearchIndex(catalog, []);
  const cases = [
    ['multi do crit', null, 'ring-multi-docrit'],
    ['terre ini', null, 'hat-earth-ini'],
    ['eau distance', null, 'cape-water-distance'],
    ['grosse vita res', null, 'boots-vita-res'],
    ['anneau PA multi', null, 'ring-ap-multi']
  ];
  for (const [query, slot, expected] of cases) {
    const result = index.search(query, { slot, limit: 10 });
    assert.equal(result.results[0]?.item.id, expected, query);
    assert.ok(result.results[0]?.reasons.length >= 1, `${query} doit expliquer son ranking`);
  }
});

test('une recherche intelligente d’item ne crée aucun optimizer Worker', () => {
  const originalWorker = globalThis.Worker;
  let calls = 0;
  globalThis.Worker = class { constructor() { calls++; } };
  try {
    const index = createItemSearchIndex(catalog, []);
    index.search('anneau PA multi', { limit: 20 });
    index.search('multi do crit', { slot: 'ring', limit: 20 });
    assert.equal(calls, 0);
  } finally {
    if (originalWorker === undefined) delete globalThis.Worker;
    else globalThis.Worker = originalWorker;
  }
});
