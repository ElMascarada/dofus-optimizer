import assert from 'node:assert/strict';
import test from 'node:test';

import { optimizeSyntheticCharacteristics } from '../js/synthetic-characteristics.js';
import { optimizeSyntheticCharacteristicsTwoElementFast } from '../js/synthetic-characteristics-two-element-fast.js';

const EPS = 1e-9;
const REDUCED_CAPS = [{ amount: 20, cost: 1 }];

function close(actual, expected, label) {
  assert.ok(Math.abs(Number(actual) - Number(expected)) <= EPS, `${label}: expected ${expected}, got ${actual}`);
}

function certify(name, options) {
  test(`two-element fast path matches legacy allocator: ${name}`, () => {
    const legacy = optimizeSyntheticCharacteristics(options);
    const fast = optimizeSyntheticCharacteristicsTwoElementFast(options);
    assert.equal(fast.feasible, legacy.feasible, 'feasibility');
    assert.deepEqual(fast.allocation, legacy.allocation, 'allocation');
    close(fast.offense.minimumScore, legacy.offense.minimumScore, 'minimumScore');
    close(fast.offense.meanScore, legacy.offense.meanScore, 'meanScore');
    assert.deepEqual(fast.stats, legacy.stats, 'stats');
  });
}

certify('reduced exhaustive-shaped fire/water', {
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

certify('real soft caps with item minima and crit', {
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

certify('large no-crit two-element', {
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

test('initiative request deliberately falls back to legacy allocator', () => {
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
    optimizeSyntheticCharacteristicsTwoElementFast(options),
    optimizeSyntheticCharacteristics(options)
  );
});
