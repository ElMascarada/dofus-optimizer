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

test('Nébuleux-style temporal passive changes T1/T2/T3 damage at the final-damage stage', () => {
  const item = {
    passives: [{
      id: 'nebulous-dream',
      rules: [
        { trigger: { type: 'turn_parity', parity: 'odd' }, stats: { finalDamagePct: 20 } },
        { trigger: { type: 'turn_parity', parity: 'even' }, stats: { finalDamagePct: -10 } }
      ]
    }]
  };
  const selection = { enabled: true, weight: 1, spell, casts: { 1: 1, 2: 1, 3: 1 } };
  const result = evaluateObjective({ stats: {}, items: [item], selections: [selection], turnMode: 'sum' });
  assert.deepEqual(result.perTurn, { 1: 120, 2: 90, 3: 120 });
  assert.equal(result.score, 330);
});

test('final damage is applied after spell/melee percentage modifiers', () => {
  const damage = spellExpectedDamage(spell, { spellDamagePct: 10, meleeDamagePct: 10, finalDamagePct: 20 }, 1);
  assert.equal(damage, 144);
});

test('scenario can vary passive context independently on T1 T2 T3', () => {
  const item = { passives: [{ id: 'vulbis', rules: [{ trigger: { type: 'context_equals', key: 'attackedSinceLastTurn', value: false }, stats: { finalDamagePct: 10 } }] }] };
  const selection = { enabled: true, weight: 1, spell, casts: { 1: 1, 2: 1, 3: 1 } };
  const result = evaluateObjective({
    stats: {},
    items: [item],
    selections: [selection],
    turnMode: 'sum',
    scenario: { turns: { 1: { attackedSinceLastTurn: false }, 2: { attackedSinceLastTurn: true }, 3: { attackedSinceLastTurn: false } } }
  });
  assert.deepEqual(result.perTurn, { 1: 110.00000000000001, 2: 100, 3: 110.00000000000001 });
  assert.deepEqual(result.unresolvedPassiveContexts, []);
});

test('objective reports unresolved conditional passive context', () => {
  const item = { passives: [{ id: 'abyssal', rules: [{ trigger: { type: 'context_equals', key: 'enemyAdjacent', value: false }, stats: { mp: 1 } }] }] };
  const result = evaluateObjective({ stats: {}, items: [item], selections: [{ enabled: true, weight: 1, spell }], turnMode: 't1' });
  assert.deepEqual(result.unresolvedPassiveContexts, ['enemyAdjacent']);
});
