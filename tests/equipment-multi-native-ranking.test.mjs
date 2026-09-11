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

test('Multi balances all four elements instead of allowing one mono element to carry the score', () => {
  const policy = policyFor(['multi'], 'no_crit');
  const balanced = policy.rankStats({
    earth: 350,
    fire: 350,
    water: 350,
    air: 350,
    damageEarth: 50,
    damageFire: 50,
    damageWater: 50,
    damageAir: 50
  });
  const fireExtreme = policy.rankStats({
    fire: 1500,
    damageFire: 200
  });

  assert.deepEqual(Object.keys(balanced.syntheticOffense.multiElementScores).sort(), ['air', 'earth', 'fire', 'water']);
  assert.ok(balanced.objective > fireExtreme.objective);
});

test('combined set-core ranking includes activated set bonuses before member injection', () => {
  const items = [
    {
      id: 'volk-like-hat',
      name: 'Volk-like Hat',
      level: 200,
      slot: 'hat',
      setId: 'volk-like',
      stats: { earth: 20 }
    },
    {
      id: 'volk-like-cape',
      name: 'Volk-like Cape',
      level: 200,
      slot: 'cape',
      setId: 'volk-like',
      stats: { fire: 20 }
    }
  ];
  const sets = [{
    id: 'volk-like',
    name: 'Volk-like',
    bonuses: {
      2: {
        power: 100,
        earth: 150,
        fire: 150,
        damageEarth: 30,
        damageFire: 30
      }
    }
  }];
  const policy = createEquipmentCandidatePolicy({
    items,
    sets,
    constraints: {},
    fmPolicy: {},
    syntheticOffense: { elements: ['earth', 'fire'], profiles: ['large'], critMode: 'auto' },
    searchProfile: 'BALANCED'
  });
  const core = policy.setCoreCatalog.cores.find((entry) => entry.setId === 'volk-like' && entry.pieceCount === 2);

  assert.ok(core);
  assert.equal(core.searchStats.power, 100);
  assert.equal(core.searchStats.earth, 170);
  assert.equal(core.searchStats.fire, 170);
  assert.equal(core.searchStats.damageEarth, 30);
  assert.equal(core.searchStats.damageFire, 30);
  assert.ok(policy.rankStats(core.searchStats).objective > policy.rankStats({ earth: 20, fire: 20 }).objective);
  assert.ok(policy.setCoreHints.some((hint) => hint.coreId === core.id));
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
