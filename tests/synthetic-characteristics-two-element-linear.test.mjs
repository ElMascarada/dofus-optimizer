import assert from 'node:assert/strict';
import test from 'node:test';

import { optimizeSyntheticCharacteristicsTwoElementFast } from '../js/synthetic-characteristics-two-element-fast.js';
import { optimizeSyntheticCharacteristicsTwoElementLinear } from '../js/synthetic-characteristics-two-element-linear.js';

const EPS = 1e-8;
const REDUCED_CAPS = [{ amount: 20, cost: 1 }];

function close(actual, expected, label) {
  assert.ok(Math.abs(Number(actual) - Number(expected)) <= EPS, `${label}: expected ${expected}, got ${actual}`);
}

function certify(name, options) {
  test(`linear two-element path matches exact fast allocator: ${name}`, () => {
    const expected = optimizeSyntheticCharacteristicsTwoElementFast(options);
    const actual = optimizeSyntheticCharacteristicsTwoElementLinear(options);
    assert.equal(actual.feasible, expected.feasible, 'feasibility');
    assert.deepEqual(actual.allocation, expected.allocation, 'allocation');
    assert.deepEqual(actual.stats, expected.stats, 'stats');
    close(actual.offense.minimumScore, expected.offense.minimumScore, 'minimumScore');
    close(actual.offense.meanScore, expected.offense.meanScore, 'meanScore');
  });
}

certify('reduced fire/water small+large', {
  baseStats: { fire: 6 },
  points: 8,
  scrolled: {},
  constraints: {},
  minimumStats: {},
  availableAp: 12,
  elements: ['fire', 'water'],
  profiles: ['small', 'large'],
  critMode: 'auto',
  softCaps: REDUCED_CAPS
});

certify('real soft caps crit context', {
  baseStats: {
    fire: 455,
    water: 390,
    earth: 120,
    air: 80,
    power: 215,
    damageFire: 65,
    damageWater: 72,
    crit: 31,
    critDamage: 44,
    spellDamagePct: 6,
    vit: 2200
  },
  points: 995,
  scrolled: { earth: 100, fire: 100, water: 100, air: 100 },
  constraints: { vit: 2500 },
  minimumStats: { fire: 650, water: 600, earth: 150 },
  availableAp: 12,
  elements: ['fire', 'water'],
  profiles: ['small'],
  critMode: 'auto'
});

certify('no-crit earth/fire large', {
  baseStats: {
    earth: 520,
    fire: 480,
    power: 180,
    damageEarth: 45,
    damageFire: 50,
    crit: 40,
    critDamage: 80
  },
  points: 995,
  scrolled: { earth: 100, fire: 100, water: 100, air: 100 },
  constraints: {},
  minimumStats: {},
  availableAp: 12,
  elements: ['earth', 'fire'],
  profiles: ['large'],
  critMode: 'no_crit'
});

test('initiative still delegates to the previous exact path', () => {
  const options = {
    baseStats: { fire: 50, water: 60 },
    points: 50,
    scrolled: {},
    constraints: { initiative: 100 },
    minimumStats: {},
    availableAp: 12,
    elements: ['fire', 'water'],
    profiles: ['large'],
    critMode: 'auto',
    softCaps: [{ amount: 100, cost: 1 }]
  };
  assert.deepEqual(
    optimizeSyntheticCharacteristicsTwoElementLinear(options),
    optimizeSyntheticCharacteristicsTwoElementFast(options)
  );
});
