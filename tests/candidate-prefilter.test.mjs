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

test('combo AP requirement is promoted into the prefilter search target', () => {
  const result = prefilterItems({
    items: [
      { id: 'earth-amu', slot: 'amulet', stats: { earth: 80 } },
      { id: 'ap-fire-amu', slot: 'amulet', stats: { fire: 80, ap: 1 } }
    ],
    selections: earthSelections,
    constraints: { ap: 12 },
    scenario: { requiredApByTurn: { 1: 14, 2: 12, 3: 12 } },
    slotRules: [{ id: 'amulet', count: 1 }]
  });

  assert.equal(result.diagnostics.apTarget, 14);
  assert.ok(ids(result).includes('ap-fire-amu'));
});

test('off-element set piece remains eligible when its set bonus helps the target build', () => {
  const result = prefilterItems({
    items: [
      { id: 'earth-cape', slot: 'cape', stats: { earth: 80 } },
      { id: 'fire-set-cape', slot: 'cape', setId: 'earth-set', stats: { fire: 120 } },
      { id: 'earth-set-hat', slot: 'hat', setId: 'earth-set', stats: { earth: 10 } }
    ],
    sets: [{ id: 'earth-set', bonuses: { '2': { earth: 60, power: 20 } } }],
    selections: earthSelections,
    constraints: {},
    slotRules: [{ id: 'cape', count: 1 }, { id: 'hat', count: 1 }]
  });

  assert.ok(ids(result).includes('fire-set-cape'));
});

test('large multi-pick slots are capped aggressively before exact search', () => {
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

  assert.equal(result.items.length, 22);
  assert.equal(result.diagnostics.slots[0].afterShortlist, 22);
});

test('a strong two-piece set is kept as a coherent block even when both items are weak alone', () => {
  const filler = Array.from({ length: 40 }, (_, index) => ({
    id: `ring-${index}`,
    slot: 'ring',
    stats: { earth: 200 - index }
  }));
  const items = [
    ...filler,
    { id: 'set-ring-a', slot: 'ring', setId: 'burst-set', stats: { earth: 5 } },
    { id: 'set-ring-b', slot: 'ring', setId: 'burst-set', stats: { earth: 4 } }
  ];
  const result = prefilterItems({
    items,
    sets: [{ id: 'burst-set', name: 'Burst', bonuses: { '2': { earth: 500, power: 100 } } }],
    selections: earthSelections,
    constraints: {},
    slotRules: [{ id: 'ring', count: 2 }]
  });

  assert.ok(ids(result).includes('set-ring-a'));
  assert.ok(ids(result).includes('set-ring-b'));
  assert.equal(result.diagnostics.topSetPlans[0].setId, 'burst-set');
  assert.equal(result.diagnostics.topSetPlans[0].targetCount, 2);
});

test('Do Crit set synergy is evaluated from item plus set bonus, not items in isolation', () => {
  const critSpell = {
    id: 'crit',
    baseCritPct: 100,
    hits: [
      { element: 'earth', normal: [10, 10], crit: [20, 20] },
      { element: 'fire', normal: [10, 10], crit: [20, 20] }
    ]
  };
  const critSelections = [{ enabled: true, weight: 1, spell: critSpell, casts: { 1: 1 } }];
  const filler = Array.from({ length: 40 }, (_, index) => ({
    id: `generic-${index}`,
    slot: 'ring',
    stats: { power: 120 - index }
  }));
  const result = prefilterItems({
    items: [
      ...filler,
      { id: 'crit-set-a', slot: 'ring', setId: 'crit-set', stats: { critDamage: 10 } },
      { id: 'crit-set-b', slot: 'ring', setId: 'crit-set', stats: { critDamage: 10 } }
    ],
    sets: [{ id: 'crit-set', name: 'Crit', bonuses: { '2': { critDamage: 120, power: 40 } } }],
    selections: critSelections,
    constraints: {},
    slotRules: [{ id: 'ring', count: 2 }]
  });

  assert.ok(ids(result).includes('crit-set-a'));
  assert.ok(ids(result).includes('crit-set-b'));
  assert.equal(result.diagnostics.topSetPlans[0].setId, 'crit-set');
});
