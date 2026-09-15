import assert from 'node:assert/strict';
import test from 'node:test';

import { dofusPackageDominanceKeys } from '../optimizer/dofus-package-frontier.js';

function keySet(syntheticOffense, constraints = {}, pool = []) {
  return new Set(dofusPackageDominanceKeys(syntheticOffense, constraints, pool));
}

test('no-crit Dofus frontier ignores crit dimensions that cannot affect requested synthetic offense', () => {
  const keys = keySet({
    elements: ['earth', 'fire', 'air'],
    profiles: ['large'],
    critMode: 'no_crit'
  }, { ap: 12, mp: 5 });

  for (const key of ['power', 'damage', 'spellDamagePct', 'earth', 'fire', 'air', 'damageEarth', 'damageFire', 'damageAir']) {
    assert.equal(keys.has(key), true, `expected ${key} to remain relevant`);
  }
  assert.equal(keys.has('crit'), false);
  assert.equal(keys.has('critDamage'), false);
  assert.equal(keys.has('range'), false);
  assert.equal(keys.has('ap'), false, 'AP is represented by the frontier resource bucket');
  assert.equal(keys.has('mp'), false, 'MP is represented by the frontier resource bucket');
});

test('auto/crit requests retain crit dimensions', () => {
  const keys = keySet({ elements: ['multi'], profiles: ['large'], critMode: 'auto' });
  assert.equal(keys.has('crit'), true);
  assert.equal(keys.has('critDamage'), true);
});

test('constraints and dynamic item conditions restore otherwise irrelevant dimensions', () => {
  const constrained = keySet({
    elements: ['earth', 'fire', 'air'],
    profiles: ['large'],
    critMode: 'no_crit'
  }, { range: 4 });
  assert.equal(constrained.has('range'), true);

  const conditioned = keySet({
    elements: ['earth', 'fire', 'air'],
    profiles: ['large'],
    critMode: 'no_crit'
  }, {}, [{
    id: 'condition-witness',
    conditions: { stat: 'critDamage', operator: 'gte', value: 40 }
  }]);
  assert.equal(conditioned.has('critDamage'), true);
});
