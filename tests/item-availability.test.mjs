import test from 'node:test';
import assert from 'node:assert/strict';
import { isOptimizerAvailableItem, unavailableItemReason } from '../js/item-availability.js';
import { isInternalOrNonPlayerItem, isPlayerEquipmentScope, selectSnapshotItems } from '../js/data-certification.js';
import { validateDofusSnapshot } from '../js/data-loader.js';

const ramboton = {
  id: 'item-8575',
  ankamaId: 8575,
  name: 'Le Ramboton',
  level: 200,
  slot: 'weapon',
  typeName: 'Bâton',
  certified: true,
  certification: { certified: true },
  setId: null,
  stats: { mp: 1, power: 25 }
};

const normalWeapon = {
  id: 'item-999999',
  ankamaId: 999999,
  name: 'Arme normale',
  level: 197,
  slot: 'weapon',
  typeName: 'Bâton',
  certified: true,
  certification: { certified: true },
  setId: null,
  stats: { power: 100 }
};

test('curated availability registry excludes Le Ramboton by Ankama id', () => {
  assert.equal(unavailableItemReason(ramboton), 'historical-unique-item');
  assert.equal(isOptimizerAvailableItem(ramboton), false);
  assert.equal(isOptimizerAvailableItem(normalWeapon), true);
});

test('normalization snapshot selection cannot reintroduce unavailable historical equipment', () => {
  assert.equal(isInternalOrNonPlayerItem(ramboton), true);
  assert.equal(isPlayerEquipmentScope(ramboton), false);
  assert.deepEqual(selectSnapshotItems([ramboton, normalWeapon], []).map((item) => item.id), ['item-999999']);
});

test('browser loader strips unavailable items even from an older static snapshot', () => {
  const data = validateDofusSnapshot({
    schemaVersion: 1,
    source: 'test',
    items: [ramboton, normalWeapon],
    sets: []
  });
  assert.deepEqual(data.items.map((item) => item.id), ['item-999999']);
});
