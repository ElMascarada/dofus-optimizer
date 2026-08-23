import test from 'node:test';
import assert from 'node:assert/strict';
import {
  castCap,
  defaultDistance,
  distanceOptions,
  requiredApByTurn,
  spellElementLabel,
  spellsForBreed
} from '../js/spell-selection.js';

const spellA = { id: 'a', breedId: 'breed-1', apCost: 3, distanceOptions: ['melee'], hits: [{ element: 'earth' }], maxCastPerTurn: 3, maxCastPerTarget: 2 };
const spellB = { id: 'b', breedId: 'breed-1', apCost: 4, distanceOptions: ['melee', 'ranged'], hits: [{ element: 'fire' }, { element: 'water' }], maxCastPerTurn: 0, maxCastPerTarget: 0 };
const spellC = { id: 'c', breedId: 'breed-2', apCost: 2, distanceOptions: ['ranged'], hits: [{ element: 'air' }] };
const data = {
  breeds: [
    { id: 'breed-1', spellIds: ['a', 'b'] },
    { id: 'breed-2', spellIds: ['c'] }
  ],
  spells: [spellA, spellB, spellC]
};

test('filters the real catalog by selected class', () => {
  assert.deepEqual(spellsForBreed(data, 'breed-1').map((spell) => spell.id), ['a', 'b']);
});

test('cast cap respects both per-turn and per-target restrictions', () => {
  assert.equal(castCap(spellA), 2);
  assert.equal(castCap(spellB), 6);
});

test('mixed melee/ranged spells have no hidden default distance', () => {
  assert.deepEqual(distanceOptions(spellB), ['melee', 'ranged']);
  assert.equal(defaultDistance(spellB), null);
  assert.equal(defaultDistance(spellA), 'melee');
});

test('summarizes multi-element spell hits', () => {
  assert.equal(spellElementLabel(spellB), 'Feu / Eau');
});

test('computes exact AP required by the selected T1/T2/T3 combo', () => {
  const required = requiredApByTurn([
    { enabled: true, spell: spellA, casts: { 1: 2, 2: 1, 3: 0 } },
    { enabled: true, spell: spellB, casts: { 1: 1, 2: 0, 3: 2 } },
    { enabled: false, spell: spellC, casts: { 1: 99, 2: 99, 3: 99 } }
  ]);
  assert.deepEqual(required, { 1: 10, 2: 3, 3: 8 });
});
