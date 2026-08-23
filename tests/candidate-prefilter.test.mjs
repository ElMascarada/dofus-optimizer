import test from 'node:test';
import assert from 'node:assert/strict';
import { activeSpellElements, prefilterItems } from '../js/candidate-prefilter.js';

const earthSpell = {
  id: 'earth',
  hits: [{ element: 'earth', normal: [10, 10] }]
};
const fireSpell = {
  id: 'fire',
  hits: [{ element: 'fire', normal: [10, 10] }]
};

const earthSelections = [{ enabled: true, weight: 1, spell: earthSpell, casts: { 1: 1 } }];

function ids(result) {
  return result.items.map((item) => item.id);
}

test('detects mono-element and multi-element spell selections', () => {
  assert.deepEqual(activeSpellElements(earthSelections), ['earth']);
  assert.deepEqual(activeSpellElements([
    ...earthSelections,
    { enabled: true, weight: 1, spell: fireSpell, casts: { 1: 1 } }
  ]).sort(), ['earth', 'fire']);
});

test('mono-element prefilter drops purely off-element gear', () => {
  const result = prefilterItems({
    items: [
      { id: 'earth-hat', slot: 'hat', stats: { earth: 80 } },
      { id: 'fire-hat', slot: 'hat', stats: { fire: 120 } }
    ],
    selections: earthSelections,
    constraints: {},
    slotRules: [{ id: 'hat', count: 1 }]
  });

  assert.deepEqual(ids(result), ['earth-hat']);
  assert.equal(result.diagnostics.targetElement, 'earth');
});

test('mono-element prefilter keeps structural AP or MP pieces needed by hard constraints', () => {
  const result = prefilterItems({
    items: [
      { id: 'earth-amu', slot: 'amulet', stats: { earth: 80 } },
      { id: 'ap-fire-amu', slot: 'amulet', stats: { fire: 80, ap: 1 } }
    ],
    selections: earthSelections,
    constraints: { ap: 12, mp: 6 },
    slotRules: [{ id: 'amulet', count: 1 }]
  });

  assert.ok(ids(result).includes('ap-fire-amu'));
});

test('off-element set piece remains eligible when its set bonus helps the target build', () => {
  const result = prefilterItems({
    items: [
      { id: 'earth-cape', slot: 'cape', stats: { earth: 80 } },
      { id: 'fire-set-cape', slot: 'cape', setId: 'earth-set', stats: { fire: 120 } }
    ],
    sets: [{ id: 'earth-set', bonuses: { '2': { earth: 60, power: 20 } } }],
    selections: earthSelections,
    constraints: {},
    slotRules: [{ id: 'cape', count: 1 }]
  });

  assert.ok(ids(result).includes('fire-set-cape'));
});

test('large slots are capped before exact search', () => {
  const items = Array.from({ length: 100 }, (_, index) => ({
    id: `d-${index}`,
    slot: 'dofus',
    stats: { earth: 100 - index }
  }));
  const result = prefilterItems({
    items,
    selections: earthSelections,
    constraints: {},
    slotRules: [{ id: 'dofus', count: 6 }]
  });

  assert.equal(result.items.length, 32);
  assert.equal(result.diagnostics.slots[0].afterShortlist, 32);
});
