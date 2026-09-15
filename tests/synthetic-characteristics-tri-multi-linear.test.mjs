import assert from 'node:assert/strict';
import test from 'node:test';

import { optimizeSyntheticCharacteristics } from '../js/synthetic-characteristics.js';
import { optimizeSyntheticCharacteristicsTriMultiLinear } from '../js/synthetic-characteristics-tri-multi-linear.js';

const SCROLLED = Object.freeze({ earth: 100, fire: 100, water: 100, air: 100 });

function assertEquivalent(options) {
  const legacy = optimizeSyntheticCharacteristics(options);
  const linear = optimizeSyntheticCharacteristicsTriMultiLinear(options);
  assert.equal(linear.feasible, legacy.feasible);
  assert.equal(linear.reason || null, legacy.reason || null);
  if (!legacy.feasible) return;

  assert.equal(linear.fastPath, 'tri-multi-linear');
  assert.deepEqual(linear.allocation, legacy.allocation);
  assert.equal(linear.deterministicAllocationKey, legacy.deterministicAllocationKey);
  assert.ok(Math.abs(Number(linear.offense.minimumScore) - Number(legacy.offense.minimumScore)) < 1e-7);
  assert.ok(Math.abs(Number(linear.offense.meanScore) - Number(legacy.offense.meanScore)) < 1e-7);
}

test('tri-element large no-crit linear allocation is identical to legacy', () => {
  assertEquivalent({
    baseStats: {
      earth: 530, fire: 470, water: 120, air: 505,
      power: 185, damage: 31,
      damageEarth: 82, damageFire: 76, damageWater: 24, damageAir: 79,
      spellDamagePct: 6, crit: 54, critDamage: 112,
      vit: 3600, ap: 12, mp: 5
    },
    points: 995,
    scrolled: SCROLLED,
    constraints: { ap: 12, mp: 5 },
    minimumStats: {},
    availableAp: 12,
    elements: ['earth', 'fire', 'air'],
    profiles: ['large'],
    critMode: 'no_crit'
  });
});

test('tri-element auto mixed profiles linear allocation is identical to legacy', () => {
  assertEquivalent({
    baseStats: {
      earth: 410, fire: 525, water: 95, air: 455,
      power: 230, damage: 44,
      damageEarth: 71, damageFire: 91, damageWater: 18, damageAir: 67,
      spellDamagePct: 4, crit: 62, critDamage: 138,
      vit: 3450, ap: 12, mp: 6
    },
    points: 995,
    scrolled: SCROLLED,
    constraints: { ap: 12, mp: 6 },
    minimumStats: { earth: 300 },
    availableAp: 12,
    elements: ['earth', 'fire', 'air'],
    profiles: ['small', 'large'],
    critMode: 'auto'
  });
});

test('multi large no-crit linear allocation is identical to legacy', () => {
  assertEquivalent({
    baseStats: {
      earth: 390, fire: 420, water: 405, air: 375,
      power: 260, damage: 38,
      damageEarth: 58, damageFire: 61, damageWater: 63, damageAir: 55,
      spellDamagePct: 7, crit: 45, critDamage: 104,
      vit: 3700, ap: 12, mp: 5
    },
    points: 995,
    scrolled: SCROLLED,
    constraints: { ap: 12, mp: 5 },
    minimumStats: {},
    availableAp: 12,
    elements: ['multi'],
    profiles: ['large'],
    critMode: 'no_crit'
  });
});

test('multi auto mixed profiles with characteristic floors is identical to legacy', () => {
  assertEquivalent({
    baseStats: {
      earth: 360, fire: 445, water: 395, air: 430,
      power: 215, damage: 47,
      damageEarth: 52, damageFire: 73, damageWater: 60, damageAir: 69,
      spellDamagePct: 5, crit: 58, critDamage: 126,
      vit: 3300, ap: 12, mp: 6
    },
    points: 995,
    scrolled: SCROLLED,
    constraints: { ap: 12, mp: 6, vit: 3500 },
    minimumStats: { fire: 500, air: 480 },
    availableAp: 12,
    elements: ['multi'],
    profiles: ['small', 'medium', 'large'],
    critMode: 'auto'
  });
});
