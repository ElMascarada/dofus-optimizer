import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createEquipmentCandidatePolicy } from '../optimizer/equipment-candidate-policy.js';

function policyFor(elements, critMode = 'auto') {
  return createEquipmentCandidatePolicy({
    items: [],
    sets: [],
    constraints: {},
    fmPolicy: {},
    syntheticOffense: { elements, profiles: ['large'], critMode },
    searchProfile: 'BALANCED'
  });
}

test('combined candidate scoring optimizes the weakest requested element instead of a mono extreme', () => {
  const policy = policyFor(['earth', 'fire']);
  const balanced = policy.rankStats({
    earth: 500,
    fire: 500,
    damageEarth: 50,
    damageFire: 50
  });
  const fireExtreme = policy.rankStats({
    fire: 1000,
    damageFire: 100
  });

  assert.deepEqual(balanced.syntheticOffense.elements, ['earth', 'fire']);
  assert.ok(balanced.objective > fireExtreme.objective);
  assert.ok(balanced.meanObjective > 0);
});

test('each requested elemental flat damage participates in combined ranking', () => {
  const policy = policyFor(['earth', 'fire']);
  const withoutElementalDamage = policy.rankStats({ earth: 400, fire: 400 });
  const withElementalDamage = policy.rankStats({
    earth: 400,
    fire: 400,
    damageEarth: 40,
    damageFire: 40
  });

  assert.ok(withElementalDamage.objective > withoutElementalDamage.objective);
  assert.ok(withElementalDamage.meanObjective > withoutElementalDamage.meanObjective);
});

test('candidate scoring carries Sans crit semantics from the beginning of search', () => {
  const policy = policyFor(['earth', 'fire'], 'no_crit');
  const baseline = policy.rankStats({ earth: 400, fire: 400 });
  const critOnlyGain = policy.rankStats({
    earth: 400,
    fire: 400,
    crit: 100,
    critDamage: 200
  });

  assert.equal(critOnlyGain.objective, baseline.objective);
  assert.equal(critOnlyGain.meanObjective, baseline.meanObjective);
  assert.equal(critOnlyGain.syntheticOffense.critMode, 'no_crit');
});

test('multi-element request orchestration no longer seeds frozen mono winners', () => {
  const source = readFileSync(new URL('../js/equipment-search-request.js', import.meta.url), 'utf8');
  assert.match(source, /requestSearchMode: combinedRequest \? 'multi-element-native'/);
  assert.doesNotMatch(source, /multi-element-seed/);
  assert.doesNotMatch(source, /multiElementSeeded/);
});
