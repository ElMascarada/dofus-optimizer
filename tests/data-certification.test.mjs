import test from 'node:test';
import assert from 'node:assert/strict';
import {
  collectUnknownSlotTypes,
  equipmentForCoverage,
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
    { id: 'free', certification: { certified: true }, setId: null },
    { id: 'safe', certification: { certified: true }, setId: 'set-safe' },
    { id: 'unsafe', certification: { certified: true }, setId: 'set-unsafe' },
    { id: 'missing', certification: { certified: true }, setId: 'set-missing' }
  ];
  const sets = [
    { id: 'set-safe', certification: { certified: true, coverage: [{ active: 0 }] } },
    { id: 'set-unsafe', certification: { certified: true, coverage: [{ active: 2 }] } }
  ];
  assert.deepEqual(selectSnapshotItems(items, sets).map((item) => item.id), ['free', 'safe']);
});

test('coverage keeps unknown level-200 slot types visible and timestamp stable', () => {
  const items = [
    { id: 'unknown', level: 200, slot: null, typeName: 'Prysmaradite' },
    { id: 'old-hat', level: 199, slot: 'hat', typeName: 'Coiffe' },
    { id: 'dofus', level: 100, slot: 'dofus', typeName: 'Dofus' }
  ];
  const coverage = equipmentForCoverage(items);
  assert.deepEqual(coverage.map((item) => item.id), ['unknown', 'dofus']);
  assert.deepEqual(collectUnknownSlotTypes(coverage), { Prysmaradite: 1 });
  assert.equal(sourceGeneratedAt({ update_stamp: '2026-08-23T00:00:00Z' }, 'fallback'), '2026-08-23T00:00:00Z');
});
