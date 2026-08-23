import test from 'node:test';
import assert from 'node:assert/strict';
import {
  conditionCouldBeSatisfied,
  countSetBonuses,
  itemConditionCompatibleWithHardConstraints,
  itemConditionsAreValid,
  selectedItemConditionsCouldStillBeValid,
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

test('hard minimum constraint rejects an item whose upper condition can never coexist', () => {
  const item = { conditions: { kind: 'condition', stat: 'ap', operator: 'lt', value: 12 } };
  assert.equal(itemConditionCompatibleWithHardConstraints(item, { ap: 12 }, 200), false);
  assert.equal(itemConditionCompatibleWithHardConstraints(item, { ap: 11 }, 200), true);
});

test('partial set-bonus condition prunes as soon as its lower bound is already illegal', () => {
  const trophy = { conditions: { kind: 'condition', stat: 'setBonus', operator: 'lt', value: 2 } };
  assert.equal(selectedItemConditionsCouldStillBeValid([trophy], {
    constraints: {},
    currentSetBonus: 2,
    maxSetBonus: 5,
    upperStats: {}
  }), false);
  assert.equal(selectedItemConditionsCouldStillBeValid([trophy], {
    constraints: {},
    currentSetBonus: 1,
    maxSetBonus: 5,
    upperStats: {}
  }), true);
});

test('condition intervals only reject branches proven impossible', () => {
  const condition = { kind: 'condition', stat: 'earth', operator: 'gte', value: 500 };
  assert.equal(conditionCouldBeSatisfied(condition, { earth: { min: 0, max: 499 } }), false);
  assert.equal(conditionCouldBeSatisfied(condition, { earth: { min: 0, max: 500 } }), true);
  assert.equal(conditionCouldBeSatisfied({ ...condition, operator: 'lt', value: 500 }, { earth: { min: 499, max: 900 } }), true);
  assert.equal(conditionCouldBeSatisfied({ ...condition, operator: 'lt', value: 500 }, { earth: { min: 500, max: 900 } }), false);
});
