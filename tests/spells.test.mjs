import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateObjective, evaluateObjectiveUpperBound, evaluateTurnConstraints, requiredApForTurn, spellExpectedDamage } from '../js/spells.js';

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

test('spell damage applies to spells but weapon damage does not', () => {
  const damage = spellExpectedDamage(spell, { spellDamagePct: 6, weaponDamagePct: 50 }, 1);
  assert.equal(damage, 106);
});

test('weapon damage applies to weapon attacks but spell damage does not', () => {
  const weaponAttack = { ...spell, damageSource: 'weapon' };
  const damage = spellExpectedDamage(weaponAttack, { spellDamagePct: 50, weaponDamagePct: 6 }, 1);
  assert.equal(damage, 106);
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

test('hard constraints are checked against effective stats on every selected turn', () => {
  const item = {
    passives: [{
      id: 'pryssion-matte',
      rules: [{ trigger: { type: 'turn_in', turns: [1, 2, 3] }, stats: { ap: 1, finalDamagePct: -10 } }]
    }]
  };
  const result = evaluateTurnConstraints({
    stats: { ap: 11, mp: 6 },
    items: [item],
    constraints: { ap: 12, mp: 6 },
    turnMode: 'sum'
  });
  assert.equal(result.meets, true);
  assert.equal(result.perTurn[1].ap, 12);
  assert.equal(result.perTurn[2].ap, 12);
  assert.equal(result.perTurn[3].ap, 12);
});

test('a T1-only passive satisfies a T1 constraint but not a T1-T3 constraint', () => {
  const item = {
    passives: [{
      id: 'prycipithon-matte',
      rules: [{ trigger: { type: 'turn_in', turns: [1] }, stats: { ap: 2 } }]
    }]
  };
  const t1 = evaluateTurnConstraints({ stats: { ap: 10 }, items: [item], constraints: { ap: 12 }, turnMode: 't1' });
  const sum = evaluateTurnConstraints({ stats: { ap: 10 }, items: [item], constraints: { ap: 12 }, turnMode: 'sum' });
  assert.equal(t1.meets, true);
  assert.equal(sum.meets, false);
  assert.deepEqual(sum.deficitsByTurn, { 2: { ap: 2 }, 3: { ap: 2 } });
});

test('negative temporal stats are enforced by hard constraints', () => {
  const item = {
    passives: [{
      id: 'prynyang',
      rules: [{ trigger: { type: 'turn_in', turns: [1] }, stats: { resEarth: -10, finalDamagePct: 10 } }]
    }]
  };
  const result = evaluateTurnConstraints({ stats: { resEarth: 40 }, items: [item], constraints: { resEarth: 40 }, turnMode: 't1' });
  assert.equal(result.meets, false);
  assert.deepEqual(result.deficitsByTurn, { 1: { resEarth: 10 } });
});

test('spell casts compute and enforce their real AP requirement per turn', () => {
  const fourApSpell = { ...spell, apCost: 4 };
  const selections = [{ enabled: true, spell: fourApSpell, casts: { 1: 3, 2: 2, 3: 1 } }];
  assert.equal(requiredApForTurn(selections, 1), 12);
  assert.equal(requiredApForTurn(selections, 2), 8);

  const hiddenWorkerConstraint = evaluateTurnConstraints({
    stats: { ap: 11 },
    constraints: { ap: 0, __requiredApByTurn: { 1: 12 } },
    turnMode: 't1'
  });
  assert.equal(hiddenWorkerConstraint.meets, false);
  assert.deepEqual(hiddenWorkerConstraint.deficitsByTurn, { 1: { ap: 1 } });

  const withTemporaryAp = evaluateTurnConstraints({
    stats: { ap: 11 },
    items: [{ passives: [{ id: 'temp-ap', rules: [{ trigger: { type: 'turn_in', turns: [1] }, stats: { ap: 1 } }] }] }],
    constraints: { ap: 0, __requiredApByTurn: { 1: 12 } },
    turnMode: 't1'
  });
  assert.equal(withTemporaryAp.meets, true);
});

test('branch-and-bound objective upper bound never falls below an achievable mixed-crit objective', () => {
  const mixedSpell = { baseCritPct: 35, distance: 'ranged', hits: [{ element: 'fire', normal: [80, 90], crit: [105, 115] }] };
  const selection = { enabled: true, weight: 1.4, spell: mixedSpell, casts: { 1: 2, 2: 1, 3: 3 } };
  const stats = { fire: 420, power: 180, crit: 28, critDamage: 35, spellDamagePct: 12, rangedDamagePct: 8, finalDamagePct: 7 };
  for (const mode of ['t1', 't2', 't3', 'sum', 'average', 'min']) {
    const actual = evaluateObjective({ stats, selections: [selection], turnMode: mode }).score;
    const upper = evaluateObjectiveUpperBound({ stats, selections: [selection], turnMode: mode }).score;
    assert.ok(upper >= actual, `${mode}: ${upper} should be >= ${actual}`);
  }
});
