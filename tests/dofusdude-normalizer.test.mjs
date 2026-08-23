import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCoverageReport,
  evaluateCondition,
  normalizeConditionNode,
  normalizeEffect,
  normalizeEquipmentItem,
  normalizeMount,
  normalizeSet,
  shouldIncludeEquipment,
  slotFromEquipment
} from '../js/dofusdude-normalizer.js';

const elements = [];
elements[0] = 'Vitality';
elements[1] = 'Strength';
elements[2] = '% Earth Resistance';
elements[3] = 'Earth Resistance';
elements[4] = 'Critical Damage';
elements[5] = 'AP';
elements[6] = 'Level';
elements[99] = 'Unsupported Future Stat';

function effect(typeId, min, max = min, extra = {}) {
  return {
    int_minimum: min,
    int_maximum: max,
    ignore_int_min: false,
    ignore_int_max: min === max,
    type: { id: typeId, is_active: false, is_meta: false },
    formatted: `${min}..${max}`,
    ...extra
  };
}

test('normalizes max item rolls and keeps fixed/% resistances separate', () => {
  assert.deepEqual(normalizeEffect(effect(1, 61, 80), elements), {
    name: 'Strength', effectTypeId: 1, formatted: '61..80', sourceRange: [61, 80], status: 'mapped', stat: 'earth', value: 80
  });
  assert.equal(normalizeEffect(effect(2, 6, 10), elements).stat, 'resEarth');
  assert.equal(normalizeEffect(effect(3, 6, 10), elements).stat, 'fixedResEarth');
});

test('active and unknown effects never silently become passive stats', () => {
  assert.equal(normalizeEffect(effect(1, 10, 10, { type: { id: 1, is_active: true, is_meta: false } }), elements).status, 'active');
  assert.equal(normalizeEffect(effect(99, 10), elements).status, 'unmapped');
});

test('maps equipment slots including weapons and six-slot Dofus family', () => {
  assert.equal(slotFromEquipment({ type: { name: 'Coiffe' } }), 'hat');
  assert.equal(slotFromEquipment({ type: { name: 'Trophée' } }), 'dofus');
  assert.equal(slotFromEquipment({ type: { name: 'Épée' }, is_weapon: true }), 'weapon');
  assert.equal(slotFromEquipment({ type: { name: 'Familier' } }), 'companion');
});

test('normalizes and evaluates condition trees', () => {
  const raw = {
    is_operand: false,
    relation: 'and',
    children: [
      { is_operand: true, condition: { operator: '>=', int_value: 100, element: { id: 1 } } },
      { is_operand: true, condition: { operator: '<=', int_value: 200, element: { id: 6 } } }
    ]
  };
  const normalized = normalizeConditionNode(raw, elements);
  assert.equal(normalized.status, 'supported');
  assert.equal(evaluateCondition(normalized.node, { earth: 100, level: 200 }), true);
  assert.equal(evaluateCondition(normalized.node, { earth: 99, level: 200 }), false);
});

test('equipment inclusion keeps gear from level 190 plus lower-level Dofus and companions', () => {
  const level189 = normalizeEquipmentItem({ ankama_id: 1, name: 'Hat 189', level: 189, type: { name: 'Coiffe' }, effects: [] }, elements);
  const level190 = normalizeEquipmentItem({ ankama_id: 2, name: 'Hat 190', level: 190, type: { name: 'Coiffe' }, effects: [] }, elements);
  const level199 = normalizeEquipmentItem({ ankama_id: 3, name: 'Hat 199', level: 199, type: { name: 'Coiffe' }, effects: [] }, elements);
  const dofus = normalizeEquipmentItem({ ankama_id: 4, name: 'Dofus', level: 100, type: { name: 'Dofus' }, effects: [] }, elements);
  const trophy = normalizeEquipmentItem({ ankama_id: 5, name: 'Trophy', level: 150, type: { name: 'Trophée' }, effects: [] }, elements);
  const pet = normalizeEquipmentItem({ ankama_id: 6, name: 'Pet', level: 60, type: { name: 'Familier' }, effects: [] }, elements);
  const level200 = normalizeEquipmentItem({ ankama_id: 7, name: 'Hat 200', level: 200, type: { name: 'Coiffe' }, effects: [] }, elements);
  assert.equal(shouldIncludeEquipment(level189), false);
  assert.equal(shouldIncludeEquipment(level190), true);
  assert.equal(shouldIncludeEquipment(level199), true);
  assert.equal(shouldIncludeEquipment(dofus), true);
  assert.equal(shouldIncludeEquipment(trophy), true);
  assert.equal(shouldIncludeEquipment(pet), true);
  assert.equal(shouldIncludeEquipment(level200), true);
});

test('normalizes set bonuses and mounts with the same effect contract', () => {
  const set = normalizeSet({ ankama_id: 10, name: 'Set', effects: { 2: [effect(1, 20)], 3: [effect(5, 1)] } }, elements);
  assert.deepEqual(set.bonuses['2'], { earth: 20 });
  assert.deepEqual(set.bonuses['3'], { ap: 1 });
  const mount = normalizeMount({ ankama_id: 11, name: 'Mount', effects: [effect(0, 200)] }, elements);
  assert.equal(mount.slot, 'companion');
  assert.equal(mount.stats.vit, 200);
});

test('coverage report exposes unknown effects instead of hiding them', () => {
  const item = normalizeEquipmentItem({ ankama_id: 12, name: 'Future', level: 200, type: { name: 'Coiffe' }, effects: [effect(99, 1)] }, elements);
  const report = buildCoverageReport({ items: [item], sets: [], elements, version: { version: 'test' } });
  assert.equal(report.items.certified, 0);
  assert.equal(report.items.unmappedEffects, 1);
  assert.equal(report.items.unknownEffectNames['Unsupported Future Stat'], 1);
});
