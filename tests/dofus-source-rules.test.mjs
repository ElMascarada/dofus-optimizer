import test from 'node:test';
import assert from 'node:assert/strict';
import {
  filterNonCombatMetadata,
  normalizeSourceCondition,
  normalizeSourceEquipment,
  patchedElements
} from '../js/dofus-source-rules.js';

function effect(id, min, { active = false } = {}) {
  return { int_minimum: min, int_maximum: min, ignore_int_min: false, ignore_int_max: true, type: { id, is_active: active, is_meta: false }, formatted: String(min) };
}

test('current source aliases map to canonical effect names', () => {
  assert.deepEqual(patchedElements(['% Critical', 'Heal', 'Pod', 'reflected damage']), ['Critical', 'Heals', 'Pods', 'Reflect']);
});

test('known non-combat metadata is explicitly filtered', () => {
  const elements = ['Exchangeable::', 'Emote', 'Power'];
  const filtered = filterNonCombatMetadata([effect(0, 1), effect(1, 1), effect(2, 50)], elements);
  assert.equal(filtered.ignored.length, 2);
  assert.equal(filtered.kept.length, 1);
});

test('Exchangeable colon variants and cosmetic titles are ignored metadata', () => {
  const elements = ['Exchangeable:', 'Exchangeable::', 'Title:', 'Power'];
  const filtered = filterNonCombatMetadata([
    effect(0, 1), effect(1, 1), effect(2, 1), effect(3, 50)
  ], elements);
  assert.deepEqual(filtered.ignored.map((entry) => elements[entry.type.id]), ['Exchangeable:', 'Exchangeable::', 'Title:']);
  assert.equal(filtered.kept.length, 1);
});

test('Set bonus source condition becomes supported', () => {
  const elements = [];
  elements[12] = 'Set bonus';
  const result = normalizeSourceCondition({ is_operand: true, condition: { operator: '<', int_value: 2, element: { id: 12 } } }, elements);
  assert.equal(result.status, 'supported');
  assert.equal(result.node.stat, 'setBonus');
});

test('Prysmaradite uses Dofus slot and stays uncertified while temporal effect is pending', () => {
  const elements = [];
  elements[1] = 'Critical';
  const item = normalizeSourceEquipment({
    ankama_id: 22001,
    name: 'Surpryz',
    level: 200,
    type: { name: 'Prysmaradite' },
    effects: [effect(1, 10), effect(1, 1, { active: true })]
  }, elements);
  assert.equal(item.slot, 'dofus');
  assert.equal(item.slotSubtype, 'prysmaradite');
  assert.equal(item.certification.temporalEffectsPending, true);
  assert.equal(item.certification.certified, false);
});

test('Nébuleux consumes its dynamic source effect and becomes certified with a structured passive', () => {
  const item = normalizeSourceEquipment({
    ankama_id: 8698,
    name: 'Dofus Nébuleux',
    level: 180,
    type: { name: 'Dofus' },
    effects: [{ type: { id: 42, is_active: false, is_meta: true, name: 'Rêve Nébuleux' }, formatted: 'Rêve Nébuleux' }]
  }, []);
  assert.equal(item.certification.certified, true);
  assert.equal(item.passives[0].id, 'nebulous-dream');
  assert.equal(item.source.recognizedPassiveEffects.length, 1);
});

test('unrecognized meta passive is explicitly flagged as temporal pending with diagnostics', () => {
  const item = normalizeSourceEquipment({
    ankama_id: 99999,
    name: 'Dofus à passif inconnu',
    level: 200,
    type: { name: 'Dofus' },
    effects: [{ type: { id: 77, is_active: false, is_meta: true, name: '-special spell-' }, formatted: 'Passif spécial' }]
  }, []);
  assert.equal(item.certification.temporalEffectsPending, true);
  assert.equal(item.certification.certified, false);
  assert.equal(item.source.pendingDynamicEffects[0].status, 'meta');
  assert.equal(item.source.pendingDynamicEffects[0].name, '-special spell-');
});
