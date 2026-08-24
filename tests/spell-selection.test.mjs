import test from 'node:test';
import assert from 'node:assert/strict';
import {
  castCap,
  combatSpellsForElement,
  defaultDistance,
  distanceOptions,
  requiredApByTurn,
  spellElementLabel,
  spellMatchesElement,
  spellsForBreed
} from '../js/spell-selection.js';

const spellA = { id: 'a', breedId: 'breed-1', apCost: 3, distanceOptions: ['melee'], hits: [{ element: 'earth' }], maxCastPerTurn: 3, maxCastPerTarget: 2 };
const spellB = { id: 'b', breedId: 'breed-1', apCost: 4, distanceOptions: ['melee', 'ranged'], hits: [{ element: 'fire' }, { element: 'water' }], maxCastPerTurn: 0, maxCastPerTarget: 0 };
const spellC = { id: 'c', breedId: 'breed-2', apCost: 2, distanceOptions: ['ranged'], hits: [{ element: 'air' }] };
const support = { id: 'support', breedId: 'breed-1', apCost: 2, hits: [], combatModifiers: [{ scope: 'self', stats: { power: 200 }, durationTurns: 2 }] };
const offElementBuff = { id: 'fire-buff', breedId: 'breed-1', apCost: 3, hits: [{ element: 'fire' }], combatModifiers: [{ scope: 'self', stats: { power: 150 }, durationTurns: 1 }] };
const plainOffElement = { id: 'plain-fire', breedId: 'breed-1', apCost: 3, hits: [{ element: 'fire' }] };
const data = {
  breeds: [
    { id: 'breed-1', spellIds: ['a', 'b', 'support', 'fire-buff', 'plain-fire'] },
    { id: 'breed-2', spellIds: ['c'] }
  ],
  spells: [spellA, spellB, spellC, support, offElementBuff, plainOffElement]
};

test('filters the real catalog by selected class', () => {
  assert.deepEqual(spellsForBreed(data, 'breed-1').map((spell) => spell.id), ['a', 'b', 'support', 'fire-buff', 'plain-fire']);
});

test('automatic mono-element pool keeps matching damage plus useful supports', () => {
  assert.equal(spellMatchesElement(spellA, 'earth'), true);
  assert.equal(spellMatchesElement(spellB, 'earth'), false);
  assert.deepEqual(
    combatSpellsForElement(data, 'breed-1', 'earth').map((spell) => spell.id),
    ['a', 'support', 'fire-buff']
  );
});

test('automatic multi pool keeps every damaging spell plus pure support', () => {
  assert.deepEqual(
    combatSpellsForElement(data, 'breed-1', 'multi').map((spell) => spell.id),
    ['a', 'b', 'support', 'fire-buff', 'plain-fire']
  );
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
  assert.equal(spellElementLabel(support), 'Support');
});

test('computes exact AP required by the selected T1/T2/T3 combo', () => {
  const required = requiredApByTurn([
    { enabled: true, spell: spellA, casts: { 1: 2, 2: 1, 3: 0 } },
    { enabled: true, spell: spellB, casts: { 1: 1, 2: 0, 3: 2 } },
    { enabled: false, spell: spellC, casts: { 1: 99, 2: 99, 3: 99 } }
  ]);
  assert.deepEqual(required, { 1: 10, 2: 3, 3: 8 });
});