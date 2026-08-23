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

function gear(id, slot, stats, extra = {}) {
  return { id, slot, level: 200, stats, ...extra };
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
      gear('earth-hat', 'hat', { earth: 80 }),
      gear('fire-hat', 'hat', { fire: 120 })
    ],
    selections: earthSelections,
    constraints: {},
    slotRules: [{ id: 'hat', count: 1 }]
  });

  assert.deepEqual(ids(result), ['earth-hat']);
  assert.equal(result.diagnostics.targetElement, 'earth');
});

test('classic equipment below level 200 is excluded from optimizer candidates', () => {
  const result = prefilterItems({
    items: [
      gear('level-200-hat', 'hat', { earth: 80 }),
      { id: 'level-190-hat', slot: 'hat', level: 190, stats: { earth: 500 } }
    ],
    selections: earthSelections,
    constraints: {},
    slotRules: [{ id: 'hat', count: 1 }]
  });

  assert.deepEqual(ids(result), ['level-200-hat']);
});

test('mono-element prefilter keeps structural AP or MP pieces needed by hard constraints', () => {
  const result = prefilterItems({
    items: [
      gear('earth-amu', 'amulet', { earth: 80 }),
      gear('ap-fire-amu', 'amulet', { fire: 80, ap: 1 })
    ],
    selections: earthSelections,
    constraints: { ap: 12, mp: 6 },
    slotRules: [{ id: 'amulet', count: 1 }]
  });

  assert.ok(ids(result).includes('ap-fire-amu'));
});

test('combat AP requirement does not replace the permanent 12 AP prefilter target', () => {
  const result = prefilterItems({
    items: [
      gear('earth-amu', 'amulet', { earth: 80 }),
      gear('ap-fire-amu', 'amulet', { fire: 80, ap: 1 })
    ],
    selections: earthSelections,
    constraints: { ap: 12 },
    scenario: { requiredApByTurn: { 1: 14, 2: 12, 3: 12 } },
    slotRules: [{ id: 'amulet', count: 1 }]
  });

  assert.equal(result.diagnostics.apTarget, 12);
  assert.equal(result.diagnostics.comboApTarget, 14);
  assert.ok(ids(result).includes('ap-fire-amu'));
});

test('off-element set piece remains eligible when its set bonus helps the target build', () => {
  const result = prefilterItems({
    items: [
      gear('earth-cape', 'cape', { earth: 80 }),
      gear('fire-set-cape', 'cape', { fire: 120 }, { setId: 'earth-set' }),
      gear('earth-set-hat', 'hat', { earth: 10 }, { setId: 'earth-set' })
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
  const filler = Array.from({ length: 40 }, (_, index) => gear(`ring-${index}`, 'ring', { earth: 200 - index }));
  const items = [
    ...filler,
    gear('set-ring-a', 'ring', { earth: 5 }, { setId: 'burst-set' }),
    gear('set-ring-b', 'ring', { earth: 4 }, { setId: 'burst-set' })
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
  const filler = Array.from({ length: 40 }, (_, index) => gear(`generic-${index}`, 'ring', { power: 120 - index }));
  const result = prefilterItems({
    items: [
      ...filler,
      gear('crit-set-a', 'ring', { critDamage: 10 }, { setId: 'crit-set' }),
      gear('crit-set-b', 'ring', { critDamage: 10 }, { setId: 'crit-set' })
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
