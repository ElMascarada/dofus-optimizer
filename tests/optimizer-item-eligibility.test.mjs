import test from 'node:test';
import assert from 'node:assert/strict';

import { filterOptimizerEligibleItems } from '../optimizer/item-eligibility.js';

test('Optimizer excludes only trophies restricted by setBonus < 3', () => {
  const restricted = {
    id: 'restricted-trophy',
    slot: 'dofus',
    typeName: 'Trophée',
    conditions: {
      kind: 'relation',
      operator: 'and',
      children: [
        { kind: 'condition', stat: 'setBonus', operator: 'lt', value: 3 }
      ]
    }
  };
  const unrestricted = {
    id: 'unrestricted-trophy',
    slot: 'dofus',
    typeName: 'Trophée',
    conditions: null
  };
  const trueDofus = {
    id: 'true-dofus',
    slot: 'dofus',
    typeName: 'Dofus',
    conditions: null
  };

  const eligible = filterOptimizerEligibleItems([restricted, unrestricted, trueDofus]);

  assert.deepEqual(eligible.map((item) => item.id), ['unrestricted-trophy', 'true-dofus']);
});
