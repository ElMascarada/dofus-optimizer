import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONDITION_FEASIBILITY,
  analyzeNormalizedConditionFeasibility,
  countSetBonuses,
  itemConditionsAreValid,
  specialSlotRulesAreValid
} from '../js/build-legality.js';

test('set bonus count follows Dofus trophy semantics', () => {
  assert.equal(countSetBonuses([{ setId: 'a' }, { setId: 'a' }]), 1);
  assert.equal(countSetBonuses([{ setId: 'a' }, { setId: 'a' }, { setId: 'a' }]), 2);
  assert.equal(countSetBonuses([{ setId: 'a' }, { setId: 'a' }, { setId: 'b' }, { setId: 'b' }]), 2);
});

test('only one Prysmaradite can occupy the six Dofus/trophy slots', () => {
  const pryA = { slot: 'dofus', slotSubtype: 'prysmaradite' };
  const pryB = { slot: 'dofus', typeName: 'Prysmaradite' };
  assert.equal(specialSlotRulesAreValid([pryA]), true);
  assert.equal(specialSlotRulesAreValid([pryA, pryB]), false);
});

test('Set bonus condition is evaluated against the complete build', () => {
  const trophy = { conditions: { kind: 'condition', stat: 'setBonus', operator: 'lt', value: 2 } };
  const oneBonus = [trophy, { setId: 'a' }, { setId: 'a' }];
  const twoBonuses = [trophy, { setId: 'a' }, { setId: 'a' }, { setId: 'b' }, { setId: 'b' }];
  assert.equal(itemConditionsAreValid(oneBonus, {}, 200), true);
  assert.equal(itemConditionsAreValid(twoBonuses, {}, 200), false);
});

test('normal stat and level equipment conditions use final build stats', () => {
  const item = { conditions: { kind: 'relation', relation: 'and', children: [
    { kind: 'condition', stat: 'earth', operator: 'gte', value: 300 },
    { kind: 'condition', stat: 'level', operator: 'lte', value: 200 }
  ] } };
  assert.equal(itemConditionsAreValid([item], { earth: 300 }, 200), true);
  assert.equal(itemConditionsAreValid([item], { earth: 299 }, 200), false);
});

test('hard minimums prove AP < 12 OR MP < 6 impossible only when every OR branch conflicts', () => {
  const condition = {
    kind: 'relation',
    relation: 'or',
    children: [
      { kind: 'condition', stat: 'ap', operator: 'lt', value: 12 },
      { kind: 'condition', stat: 'mp', operator: 'lt', value: 6 }
    ]
  };

  assert.equal(
    analyzeNormalizedConditionFeasibility(condition, { minimums: { ap: 12, mp: 6 } }).classification,
    CONDITION_FEASIBILITY.IMPOSSIBLE
  );
  assert.equal(
    analyzeNormalizedConditionFeasibility(condition, { minimums: { ap: 12, mp: 5 } }).classification,
    CONDITION_FEASIBILITY.UNRESOLVED
  );
});

test('minimum-only feasibility respects strictness and does not invent maxima', () => {
  const classify = (operator, value, minimum = 12) => analyzeNormalizedConditionFeasibility(
    { kind: 'condition', stat: 'ap', operator, value },
    { minimums: { ap: minimum } }
  ).classification;

  assert.equal(classify('lt', 12), CONDITION_FEASIBILITY.IMPOSSIBLE);
  assert.equal(classify('lte', 12), CONDITION_FEASIBILITY.UNRESOLVED);
  assert.equal(classify('gt', 10), CONDITION_FEASIBILITY.COMPATIBLE);
  assert.equal(classify('gte', 12), CONDITION_FEASIBILITY.COMPATIBLE);
  assert.equal(classify('eq', 11), CONDITION_FEASIBILITY.IMPOSSIBLE);
  assert.equal(classify('eq', 12), CONDITION_FEASIBILITY.UNRESOLVED);
  assert.equal(classify('neq', 12), CONDITION_FEASIBILITY.UNRESOLVED);
  assert.equal(classify('neq', 10), CONDITION_FEASIBILITY.COMPATIBLE);
});

test('setBonus remains unresolved without complete-build information', () => {
  const condition = { kind: 'condition', stat: 'setBonus', operator: 'lt', value: 3 };
  assert.equal(
    analyzeNormalizedConditionFeasibility(condition, { minimums: { ap: 12, mp: 6 } }).classification,
    CONDITION_FEASIBILITY.UNRESOLVED
  );
});

test('AND is impossible when one branch is impossible while OR needs all branches impossible', () => {
  const impossible = { kind: 'condition', stat: 'ap', operator: 'lt', value: 12 };
  const unresolved = { kind: 'condition', stat: 'setBonus', operator: 'lt', value: 3 };
  const minimums = { ap: 12, mp: 6 };

  assert.equal(
    analyzeNormalizedConditionFeasibility({ kind: 'relation', relation: 'and', children: [impossible, unresolved] }, { minimums }).classification,
    CONDITION_FEASIBILITY.IMPOSSIBLE
  );
  assert.equal(
    analyzeNormalizedConditionFeasibility({ kind: 'relation', relation: 'or', children: [impossible, unresolved] }, { minimums }).classification,
    CONDITION_FEASIBILITY.UNRESOLVED
  );
});
