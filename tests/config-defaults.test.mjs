import test from 'node:test';
import assert from 'node:assert/strict';
import { BASE_CHARACTER, DEFAULT_CONSTRAINTS, DEFAULT_FM } from '../js/config.js';

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

test('default character and FM policy contain no hidden forgemagie', () => {
  assert.equal(BASE_CHARACTER.baseStats.ap, 7);
  assert.equal(BASE_CHARACTER.baseStats.mp, 3);
  assert.equal(DEFAULT_FM.spellDamagePct, 0);
  assert.equal(DEFAULT_FM.allowCritDamage, false);
  assert.equal(DEFAULT_FM.exoAp, 0);
  assert.equal(DEFAULT_FM.exoMp, 0);
});
