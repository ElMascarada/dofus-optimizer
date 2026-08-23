import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONSTRAINTS } from '../js/config.js';

test('default build constraints only require 12 AP and 6 MP', () => {
  assert.deepEqual(DEFAULT_CONSTRAINTS, {
    ap: 12,
    mp: 6,
    range: 0,
    vit: 0,
    resEarth: 0,
    resFire: 0,
    resWater: 0,
    resAir: 0
  });
});
