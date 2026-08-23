import test from 'node:test';
import assert from 'node:assert/strict';
import { optimizeFm } from '../js/fm.js';

const critSpell = { baseCritPct: 100, distance: 'melee', hits: [{ element: 'earth', normal: [1,1], crit: [1,1] }] };

test('crit damage can beat spell percent on a crit-focused tiny-base spell', () => {
  const out = optimizeFm({
    baseStats: {},
    items: [{ id: 'a', stats: {} }],
    selections: [{ enabled: true, weight: 1, spell: critSpell, casts: {1:1,2:1,3:1} }],
    turnMode: 'sum',
    policy: { spellDamagePct: 2, allowCritDamage: true, critDamageAmount: 8 }
  });
  assert.equal(out.critItems, 1);
});

test('item with native crit damage is forced to spell damage percent', () => {
  const out = optimizeFm({
    baseStats: {},
    items: [{ id: 'a', stats: { critDamage: 3 } }],
    selections: [{ enabled: true, weight: 1, spell: critSpell, casts: {1:1,2:1,3:1} }],
    turnMode: 'sum',
    policy: { spellDamagePct: 3, allowCritDamage: true, critDamageAmount: 8 }
  });
  assert.equal(out.critItems, 0);
  assert.equal(out.spellPctItems, 1);
});
