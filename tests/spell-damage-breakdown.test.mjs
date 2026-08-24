import test from 'node:test';
import assert from 'node:assert/strict';
import { spellDamageBreakdown, spellExpectedDamage } from '../js/spells.js';

const spell = {
  id: 'air-test',
  baseCritPct: 20,
  hits: [{ element: 'air', normal: [10, 20], crit: [20, 30] }],
  damageSource: 'spell'
};

test('spell damage breakdown uses the exact same expected value as ranking', () => {
  const stats = { air: 100, power: 50, crit: 30, critDamage: 10, damageAir: 5, spellDamagePct: 10 };
  const breakdown = spellDamageBreakdown(spell, stats, 1);
  assert.equal(breakdown.critChancePct, 50);
  assert.deepEqual(breakdown.normal, [33, 60.5]);
  assert.deepEqual(breakdown.critical, [71.5, 99.00000000000001]);
  assert.equal(breakdown.expected, spellExpectedDamage(spell, stats, 1));
});
