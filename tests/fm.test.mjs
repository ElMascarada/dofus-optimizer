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
