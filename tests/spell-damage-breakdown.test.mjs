import test from 'node:test';
import assert from 'node:assert/strict';
import { spellDamageBreakdown, spellExpectedDamage } from '../js/spells.js';

const spell = {
  id: 'air-test',
  baseCritPct: 20,
  hits: [{ element: 'air', normal: [10, 20], crit: [20, 30] }],
  damageSource: 'spell'
};

function close(actual, expected, epsilon = 1e-9) {
  assert.ok(Math.abs(Number(actual) - Number(expected)) <= epsilon, `${actual} ≉ ${expected}`);
}

function closeRange(actual, expected) {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, index) => close(value, expected[index]));
}

test('spell damage breakdown uses the exact same expected value as ranking', () => {
  const stats = { air: 100, power: 50, crit: 30, critDamage: 10, damageAir: 5, spellDamagePct: 10 };
  const breakdown = spellDamageBreakdown(spell, stats, 1);
  assert.equal(breakdown.critChancePct, 50);
  closeRange(breakdown.normal, [33, 60.5]);
  closeRange(breakdown.critical, [71.5, 99]);
  close(breakdown.expected, spellExpectedDamage(spell, stats, 1));
});