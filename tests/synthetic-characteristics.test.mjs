import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateSyntheticOffense } from '../js/synthetic-offense.js';
import { constraintDeficits } from '../js/stats.js';
import { optimizeSyntheticCharacteristics } from '../js/synthetic-characteristics.js';

const ELEMENTS = ['earth', 'fire', 'water', 'air'];
const EPS = 1e-9;
const REDUCED_CAPS = [{ amount: 20, cost: 1 }];

function close(actual, expected, label = 'value') {
  assert.ok(Math.abs(actual - expected) <= EPS, `${label}: expected ${expected}, got ${actual}`);
}

function oracleCost(q, caps = REDUCED_CAPS) {
  let remaining = q;
  let cost = 0;
  for (const cap of caps) {
    if (remaining <= 0) break;
    const capacity = Number.isFinite(cap.amount) ? cap.amount : remaining;
    const buy = Math.min(remaining, capacity);
    cost += buy * cap.cost;
    remaining -= buy;
  }
  return remaining > 0 ? Infinity : cost;
}

function allocationKey(allocation) {
  return [...ELEMENTS, 'vit'].map((key) => String(allocation[key] || 0).padStart(5, '0')).join('|');
}

function better(left, right) {
  if (!right) return true;
  if (left.offense.minimumScore > right.offense.minimumScore + EPS) return true;
  if (left.offense.minimumScore + EPS < right.offense.minimumScore) return false;
  if (left.offense.meanScore > right.offense.meanScore + EPS) return true;
  if (left.offense.meanScore + EPS < right.offense.meanScore) return false;
  return left.key < right.key;
}

function exhaustiveOracle({ baseStats = {}, points, scrolled = {}, constraints = {}, minimumStats = {}, availableAp = 12, elements, profiles }) {
  let best = null;
  let feasible = false;
  for (let earth = 0; earth <= points; earth++) {
    for (let fire = 0; fire <= points; fire++) {
      for (let water = 0; water <= points; water++) {
        for (let air = 0; air <= points; air++) {
          const elementalCost = oracleCost(earth) + oracleCost(fire) + oracleCost(water) + oracleCost(air);
          if (elementalCost > points) continue;
          const allocation = { earth, fire, water, air, vit: points - elementalCost };
          const stats = { ...baseStats };
          for (const element of ELEMENTS) stats[element] = Number(stats[element] || 0) + Number(scrolled[element] || 0) + allocation[element];
          stats.vit = Number(stats.vit || 0) + allocation.vit;
          if (ELEMENTS.some((element) => Number(stats[element] || 0) < Number(minimumStats[element] || 0))) continue;
          if (Object.keys(constraintDeficits(stats, constraints)).length) continue;
          feasible = true;
          const offense = evaluateSyntheticOffense({ stats, availableAp, elements, profiles });
          const candidate = { allocation, stats, offense, key: allocationKey(allocation) };
          if (better(candidate, best)) best = candidate;
        }
      }
    }
  }
  return { feasible, best };
}

function certifyCase(name, options) {
  test(`reduced exhaustive oracle: ${name}`, () => {
    const production = optimizeSyntheticCharacteristics({ ...options, softCaps: REDUCED_CAPS });
    const oracle = exhaustiveOracle(options);
    assert.equal(production.feasible, oracle.feasible, 'feasibility');
    assert.equal(production.feasible, true);
    close(production.offense.minimumScore, oracle.best.offense.minimumScore, 'minimum');
    close(production.offense.meanScore, oracle.best.offense.meanScore, 'mean');
    assert.deepEqual(production.allocation, oracle.best.allocation, 'allocation tie-break');
  });
}

certifyCase('mono', {
  baseStats: {}, points: 7, scrolled: {}, constraints: {}, minimumStats: {},
  availableAp: 12, elements: ['earth'], profiles: ['small', 'large']
});

certifyCase('two-element balance', {
  baseStats: { fire: 6 }, points: 8, scrolled: {}, constraints: {}, minimumStats: {},
  availableAp: 12, elements: ['fire', 'water'], profiles: ['small', 'large']
});

certifyCase('three-element balance', {
  baseStats: { earth: 4, fire: 2 }, points: 9, scrolled: {}, constraints: {}, minimumStats: {},
  availableAp: 11, elements: ['earth', 'fire', 'water'], profiles: ['medium']
});

certifyCase('multi single-probe objective', {
  baseStats: { earth: 10 }, points: 8, scrolled: {}, constraints: {}, minimumStats: {},
  availableAp: 11, elements: ['multi'], profiles: ['small', 'large']
});

certifyCase('item minimum first', {
  baseStats: {}, points: 6, scrolled: {}, constraints: {}, minimumStats: { earth: 5 },
  availableAp: 12, elements: ['water'], profiles: ['small']
});

certifyCase('initiative requirement first', {
  baseStats: {}, points: 6, scrolled: {}, constraints: { initiative: 5 }, minimumStats: {},
  availableAp: 12, elements: ['fire', 'water'], profiles: ['large']
});

test('two-element allocator raises the weaker side beyond naive alternatives', () => {
  const options = {
    baseStats: { fire: 6 }, points: 8, scrolled: {}, constraints: {}, minimumStats: {},
    availableAp: 12, elements: ['fire', 'water'], profiles: ['small', 'large'], softCaps: REDUCED_CAPS
  };
  const production = optimizeSyntheticCharacteristics(options);
  const allFireStats = { fire: 14, water: 0, vit: 0 };
  const equalStats = { fire: 10, water: 4, vit: 0 };
  const allFire = evaluateSyntheticOffense({ stats: allFireStats, availableAp: 12, elements: options.elements, profiles: options.profiles });
  const equal = evaluateSyntheticOffense({ stats: equalStats, availableAp: 12, elements: options.elements, profiles: options.profiles });
  assert.ok(production.offense.minimumScore > allFire.minimumScore);
  assert.ok(production.offense.minimumScore > equal.minimumScore);
  assert.ok(production.allocation.water > production.allocation.fire);
});

test('multi maximizes its one four-line score without forced equal allocation', () => {
  const production = optimizeSyntheticCharacteristics({
    baseStats: { earth: 10 }, points: 8, scrolled: {}, constraints: {}, minimumStats: {},
    availableAp: 12, elements: ['multi'], profiles: ['medium'], softCaps: REDUCED_CAPS
  });
  assert.equal(production.feasible, true);
  assert.equal(production.allocation.earth + production.allocation.fire + production.allocation.water + production.allocation.air, 8);
  assert.notDeepEqual(
    [production.allocation.earth, production.allocation.fire, production.allocation.water, production.allocation.air],
    [2, 2, 2, 2]
  );
});
