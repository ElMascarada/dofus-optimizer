import test from 'node:test';
import assert from 'node:assert/strict';
import {
  collectUnknownSlotTypes,
  equipmentForCoverage,
  isInternalOrNonPlayerItem,
  isPlayerEquipmentScope,
  isSolverSafeSet,
  selectSnapshotItems,
  sourceGeneratedAt
} from '../js/data-certification.js';

test('set active effects remain unsafe until temporal rules exist', () => {
  const passive = { id: 'set-passive', certification: { certified: true, coverage: [{ active: 0 }] } };
  const temporal = { id: 'set-temporal', certification: { certified: true, coverage: [{ active: 1 }] } };
  assert.equal(isSolverSafeSet(passive), true);
  assert.equal(isSolverSafeSet(temporal), false);
});

test('snapshot excludes otherwise-certified items linked to unsafe or missing sets', () => {
  const items = [
    { id: 'free', level: 200, slot: 'hat', certification: { certified: true }, setId: null },
    { id: 'safe', level: 200, slot: 'hat', certification: { certified: true }, setId: 'set-safe' },
    { id: 'unsafe', level: 200, slot: 'hat', certification: { certified: true }, setId: 'set-unsafe' },
    { id: 'missing', level: 200, slot: 'hat', certification: { certified: true }, setId: 'set-missing' }
  ];
  const sets = [
    { id: 'set-safe', certification: { certified: true, coverage: [{ active: 0 }] } },
    { id: 'set-unsafe', certification: { certified: true, coverage: [{ active: 2 }] } }
  ];
  assert.deepEqual(selectSnapshotItems(items, sets).map((item) => item.id), ['free', 'safe']);
});

test('classical optimizer keeps level 190+ gear while Dofus and companions stay exempt', () => {
  const items = [
    { id: 'unknown', level: 200, slot: null, typeName: 'Prysmaradite' },
    { id: 'low-hat', level: 189, slot: 'hat', typeName: 'Coiffe' },
    { id: 'floor-hat', level: 190, slot: 'hat', typeName: 'Coiffe' },
    { id: 'high-hat', level: 199, slot: 'hat', typeName: 'Coiffe' },
    { id: 'level-200-hat', level: 200, slot: 'hat', typeName: 'Coiffe' },
    { id: 'dofus', level: 100, slot: 'dofus', typeName: 'Dofus' },
    { id: 'pet', level: 60, slot: 'companion', typeName: 'Familier' },
    { id: 'collector', level: 200, slot: null, typeName: 'Fers de Percepteur' }
  ];
  const coverage = equipmentForCoverage(items);
  assert.deepEqual(coverage.map((item) => item.id), ['unknown', 'floor-hat', 'high-hat', 'level-200-hat', 'dofus', 'pet']);
  assert.deepEqual(collectUnknownSlotTypes(coverage), { Prysmaradite: 1 });
  assert.equal(sourceGeneratedAt({ update_stamp: '2026-08-23T00:00:00Z' }, 'fallback'), '2026-08-23T00:00:00Z');
});

test('internal GM/MJ equipment never enters player scope or snapshot', () => {
  const mjPet = { id: 'mj-pet', name: 'Surpuissant Chacha de Combat (MJ)', level: 200, slot: 'companion', typeName: 'Familier', certification: { certified: true }, setId: null };
  const normalPet = { id: 'pet', name: 'Chacha', level: 60, slot: 'companion', typeName: 'Familier', certification: { certified: true }, setId: null };
  assert.equal(isInternalOrNonPlayerItem(mjPet), true);
  assert.equal(isPlayerEquipmentScope(mjPet), false);
  assert.deepEqual(selectSnapshotItems([mjPet, normalPet], []).map((item) => item.id), ['pet']);
});
