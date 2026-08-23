import test from 'node:test';
import assert from 'node:assert/strict';
import { optimizeCharacteristics } from '../js/characteristics.js';

test('allocates offensive points toward the most valuable element', () => {
  const result = optimizeCharacteristics({}, {
    points: 995,
    scrolled: { earth: 100, fire: 100, water: 100, air: 100 },
    elementValues: { earth: 10, fire: 1, water: 0, air: 0 },
    minimumVitality: 0,
    baseVitality: 1095
  });
  assert.ok(result.allocation.earth > result.allocation.fire);
  assert.equal(result.remainingPoints, 0);
});

test('can reserve points for a vitality constraint first', () => {
  const result = optimizeCharacteristics({}, {
    points: 995,
    scrolled: {},
    elementValues: { earth: 10 },
    minimumVitality: 1200,
    baseVitality: 1095
  });
  assert.equal(result.allocation.vit >= 105, true);
});
