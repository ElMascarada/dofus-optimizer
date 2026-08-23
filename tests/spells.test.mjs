import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateObjective, spellExpectedDamage } from '../js/spells.js';

const spell = { baseCritPct: 0, distance: 'melee', hits: [{ element: 'earth', normal: [100, 100], crit: [100, 100] }] };

test('100 earth doubles a 100 base hit before final modifiers', () => {
  assert.equal(spellExpectedDamage(spell, { earth: 100 }), 200);
});

test('turn mode sum aggregates T1 T2 T3', () => {
  const result = evaluateObjective({ stats: {}, selections: [{ enabled: true, weight: 1, spell, casts: { 1: 1, 2: 1, 3: 1 } }], turnMode: 'sum' });
  assert.equal(result.score, 300);
});
