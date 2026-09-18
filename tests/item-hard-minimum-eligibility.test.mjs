import assert from 'node:assert/strict';
import test from 'node:test';

import {
  filterOptimizerEligibleItems,
  itemConditionCanSatisfyHardMinimums
} from '../optimizer/item-eligibility.js';

const crocanneauCondition = {
  kind: 'relation',
  relation: 'or',
  children: [
    {
      kind: 'condition',
      stat: 'ap',
      operator: 'lt',
      value: 12,
      sourceName: 'AP'
    },
    {
      kind: 'condition',
      stat: 'mp',
      operator: 'lt',
      value: 6,
      sourceName: 'MP'
    }
  ]
};

test('Crocanneau-style AP<12 OR MP<6 is impossible under a hard 12/6 request', () => {
  assert.equal(
    itemConditionCanSatisfyHardMinimums(
      crocanneauCondition,
      { ap: 12, mp: 6 }
    ),
    false
  );
});

test('the same condition remains eligible when either branch can still be satisfied', () => {
  assert.equal(
    itemConditionCanSatisfyHardMinimums(
      crocanneauCondition,
      { ap: 11, mp: 6 }
    ),
    true
  );

  assert.equal(
    itemConditionCanSatisfyHardMinimums(
      crocanneauCondition,
      { ap: 12, mp: 5 }
    ),
    true
  );
});

test('optimizer removes only the item proven incompatible with requested minima', () => {
  const crocanneau = {
    id: 'crocanneau',
    name: 'Crocanneau',
    typeName: 'Anneau',
    conditions: crocanneauCondition
  };

  const legalRing = {
    id: 'legal-ring',
    name: 'Legal Ring',
    typeName: 'Anneau',
    conditions: null
  };

  const filtered = filterOptimizerEligibleItems(
    [crocanneau, legalRing],
    { ap: 12, mp: 6 }
  );

  assert.deepEqual(filtered.map((item) => item.id), ['legal-ring']);
});
