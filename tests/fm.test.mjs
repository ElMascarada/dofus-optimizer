import test from 'node:test';
import assert from 'node:assert/strict';
import { optimizeFm } from '../js/fm.js';

const critSpell = {
  id: 'crit',
  baseCritPct: 100,
  distance: 'melee',
  hits: [{ element: 'earth', normal: [10, 10], crit: [10, 10] }]
};

const noCritSpell = {
  id: 'normal',
  baseCritPct: 0,
  distance: 'melee',
  hits: [{ element: 'earth', normal: [100, 100], crit: [100, 100] }]
};

const nineForgeableItems = [
  { id: 'hat', slot: 'hat', stats: {} },
  { id: 'cape', slot: 'cape', stats: {} },
  { id: 'amulet', slot: 'amulet', stats: {} },
  { id: 'ring-1', slot: 'ring', stats: {} },
  { id: 'ring-2', slot: 'ring', stats: {} },
  { id: 'belt', slot: 'belt', stats: {} },
  { id: 'boots', slot: 'boots', stats: {} },
  { id: 'weapon', slot: 'weapon', stats: {} },
  { id: 'shield', slot: 'shield', stats: {} }
];

test('explicit offensive FM picks +8 crit damage when it is stronger', () => {
  const result = optimizeFm({
    baseStats: { earth: 0 },
    items: [{ id: 'a', slot: 'hat', stats: {} }],
    selections: [{ enabled: true, weight: 1, spell: critSpell, casts: { 1: 1 } }],
    turnMode: 't1',
    policy: { spellDamagePct: 3, allowCritDamage: true, critDamageAmount: 8 }
  });
  assert.equal(result.critItems, 1);
  assert.equal(result.spellPctItems, 0);
});

test('explicit offensive FM picks % spell damage when it is stronger', () => {
  const result = optimizeFm({
    baseStats: { earth: 1000 },
    items: [{ id: 'a', slot: 'hat', stats: {} }],
    selections: [{ enabled: true, weight: 1, spell: noCritSpell, casts: { 1: 1 } }],
    turnMode: 't1',
    policy: { spellDamagePct: 3, allowCritDamage: true, critDamageAmount: 8 }
  });
  assert.equal(result.critItems, 0);
  assert.equal(result.spellPctItems, 1);
});

test('no FM selection means no offensive or structural FM', () => {
  const result = optimizeFm({
    baseStats: { earth: 0, crit: 100, ap: 7, mp: 3 },
    items: [{ id: 'a', slot: 'hat', stats: {} }],
    selections: [{ enabled: true, weight: 1, spell: critSpell, casts: { 1: 1 } }],
    turnMode: 't1',
    policy: {}
  });
  assert.equal(result.critItems, 0);
  assert.equal(result.spellPctItems, 0);
  assert.equal(result.stats.spellDamagePct || 0, 0);
  assert.equal(result.stats.critDamage || 0, 0);
  assert.equal(result.stats.ap, 7);
  assert.equal(result.stats.mp, 3);
  assert.equal(result.structuralExos, 0);
  assert.equal(result.assignments[0].type, 'none');
});

test('Do Crit can be explicitly enabled while Do Sorts remains disabled', () => {
  const result = optimizeFm({
    baseStats: { earth: 0, crit: 100 },
    items: [{ id: 'a', slot: 'hat', stats: {} }],
    selections: [{ enabled: true, weight: 1, spell: critSpell, casts: { 1: 1 } }],
    turnMode: 't1',
    policy: { spellDamagePct: 0, allowCritDamage: true, critDamageAmount: 8 }
  });
  assert.equal(result.critItems, 1);
  assert.equal(result.spellPctItems, 0);
  assert.equal(result.stats.spellDamagePct || 0, 0);
  assert.equal(result.stats.critDamage, 8);
  assert.equal(result.assignments[0].type, 'critDamage');
});

test('Do Sorts enabled on nine eligible slots adds exactly +27%', () => {
  const result = optimizeFm({
    baseStats: { earth: 1000 },
    items: nineForgeableItems,
    selections: [{ enabled: true, weight: 1, spell: noCritSpell, casts: { 1: 1 } }],
    turnMode: 't1',
    policy: { spellDamagePct: 3, allowCritDamage: false, critDamageAmount: 8 }
  });
  assert.equal(result.spellPctItems, 9);
  assert.equal(result.stats.spellDamagePct, 27);
  assert.equal(result.critItems, 0);
});

test('Do Sorts disabled on nine eligible slots adds no +27%', () => {
  const result = optimizeFm({
    baseStats: { earth: 1000 },
    items: nineForgeableItems,
    selections: [{ enabled: true, weight: 1, spell: noCritSpell, casts: { 1: 1 } }],
    turnMode: 't1',
    policy: { spellDamagePct: 0, allowCritDamage: false, critDamageAmount: 8 }
  });
  assert.equal(result.spellPctItems, 0);
  assert.equal(result.stats.spellDamagePct || 0, 0);
});

test('FM never applies to Dofus, trophies or companions', () => {
  const result = optimizeFm({
    baseStats: { earth: 0 },
    items: [
      { id: 'hat', slot: 'hat', stats: {} },
      { id: 'dofus', slot: 'dofus', stats: {} },
      { id: 'pet', slot: 'companion', stats: {} }
    ],
    selections: [{ enabled: true, weight: 1, spell: critSpell, casts: { 1: 1 } }],
    turnMode: 't1',
    policy: { spellDamagePct: 3, allowCritDamage: true, critDamageAmount: 8 }
  });
  assert.equal(result.assignments.find((entry) => entry.itemId === 'dofus').type, 'none');
  assert.equal(result.assignments.find((entry) => entry.itemId === 'pet').type, 'none');
  assert.equal(result.critItems + result.spellPctItems, 1);
});

test('structural exos are independent explicit +1 AP and +1 MP choices', () => {
  const apOnly = optimizeFm({
    baseStats: { earth: 1000, ap: 7, mp: 3 },
    items: [{ id: 'hat', slot: 'hat', stats: {} }],
    selections: [{ enabled: true, weight: 1, spell: noCritSpell, casts: { 1: 1 } }],
    turnMode: 't1',
    policy: { spellDamagePct: 0, allowCritDamage: false, exoAp: 1, exoMp: 0 }
  });
  assert.equal(apOnly.stats.ap, 8);
  assert.equal(apOnly.stats.mp, 3);
  assert.equal(apOnly.structuralExos, 1);

  const mpOnly = optimizeFm({
    baseStats: { earth: 1000, ap: 7, mp: 3 },
    items: [{ id: 'hat', slot: 'hat', stats: {} }],
    selections: [{ enabled: true, weight: 1, spell: noCritSpell, casts: { 1: 1 } }],
    turnMode: 't1',
    policy: { spellDamagePct: 0, allowCritDamage: false, exoAp: 0, exoMp: 1 }
  });
  assert.equal(mpOnly.stats.ap, 7);
  assert.equal(mpOnly.stats.mp, 4);
  assert.equal(mpOnly.structuralExos, 1);
});

test('legacy explicit structuralExos pair remains deterministic without becoming a product default', () => {
  const result = optimizeFm({
    baseStats: { earth: 1000, ap: 11, mp: 5 },
    items: [
      { id: 'hat', slot: 'hat', stats: {} },
      { id: 'cape', slot: 'cape', stats: {} },
      { id: 'ring', slot: 'ring', stats: {} },
      { id: 'dofus', slot: 'dofus', stats: {} }
    ],
    selections: [{ enabled: true, weight: 1, spell: noCritSpell, casts: { 1: 1 } }],
    turnMode: 't1',
    policy: {
      spellDamagePct: 3,
      allowCritDamage: false,
      critDamageAmount: 8,
      structuralExos: true
    }
  });

  assert.equal(result.stats.ap, 12);
  assert.equal(result.stats.mp, 6);
  assert.equal(result.structuralExos, 2);
  assert.equal(result.spellPctItems, 3);
  assert.equal(result.assignments.filter((entry) => entry.type === 'exoAp').length, 0);
  assert.equal(result.assignments.filter((entry) => entry.type === 'exoMp').length, 0);
  assert.equal(result.assignments.find((entry) => entry.itemId === 'dofus').type, 'none');
});
