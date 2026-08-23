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

test('FM auto picks +8 crit damage when it is stronger', () => {
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

test('FM auto picks % spell damage when it is stronger', () => {
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

test('structural exos add +1 AP and +1 MP on two different items and consume two offensive FM slots', () => {
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
  assert.equal(result.spellPctItems, 1);
  const ap = result.assignments.find((entry) => entry.type === 'exoAp');
  const mp = result.assignments.find((entry) => entry.type === 'exoMp');
  assert.ok(ap);
  assert.ok(mp);
  assert.notEqual(ap.itemId, mp.itemId);
  assert.equal(result.assignments.find((entry) => entry.itemId === 'dofus').type, 'none');
});
