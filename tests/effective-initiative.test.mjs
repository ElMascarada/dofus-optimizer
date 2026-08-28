import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateNormalizedCondition } from '../js/build-legality.js';
import { evaluateCondition as evaluateNormalizedSourceCondition } from '../js/dofusdude-normalizer.js';
import {
  constraintDeficits,
  effectiveStat,
  effectiveStats,
  meetsConstraints,
  stat
} from '../js/stats.js';

const initiativeCases = [
  [1000, 1000],
  [0, 0],
  [-1, 0],
  [-1000, 0]
];

test('Initiative keeps a signed raw value and exposes a zero-floored effective value', () => {
  for (const [raw, effective] of initiativeCases) {
    const stats = { initiative: raw };
    assert.equal(stat(stats, 'initiative'), raw);
    assert.equal(effectiveStat(stats, 'initiative'), effective);
  }
});

test('Initiative constraints are checked against the effective Dofus value', () => {
  for (const raw of [0, -1000]) {
    assert.equal(meetsConstraints({ initiative: raw }, { initiative: 0 }), true);
    assert.deepEqual(constraintDeficits({ initiative: raw }, { initiative: 0 }), {});
  }

  for (const raw of [-1000, 0, 999]) {
    assert.equal(meetsConstraints({ initiative: raw }, { initiative: 1000 }), false);
    assert.ok(constraintDeficits({ initiative: raw }, { initiative: 1000 }).initiative > 0);
  }

  for (const raw of [1000, 1500]) {
    assert.equal(meetsConstraints({ initiative: raw }, { initiative: 1000 }), true);
    assert.deepEqual(constraintDeficits({ initiative: raw }, { initiative: 1000 }), {});
  }
});

test('all Initiative equipment-condition operators use effective Initiative', () => {
  const stats = { initiative: -1000 };
  const condition = (operator, value) => ({ kind: 'condition', stat: 'initiative', operator, value });
  const cases = [
    ['eq', 0, true],
    ['neq', 0, false],
    ['gt', 0, false],
    ['gte', 0, true],
    ['lt', 0, false],
    ['lte', 0, true]
  ];

  for (const [operator, value, expected] of cases) {
    const node = condition(operator, value);
    assert.equal(evaluateNormalizedCondition(node, stats), expected);
    assert.equal(evaluateNormalizedSourceCondition(node, stats), expected);
  }

  for (const evaluator of [evaluateNormalizedCondition, evaluateNormalizedSourceCondition]) {
    assert.equal(evaluator(condition('gte', 1000), { initiative: 999 }), false);
    assert.equal(evaluator(condition('gte', 1000), { initiative: 1000 }), true);
  }
});

test('effectiveStats normalizes product-facing Initiative without mutating raw aggregation', () => {
  const raw = { initiative: -1600, power: 250 };
  const effective = effectiveStats(raw);

  assert.equal(raw.initiative, -1600);
  assert.equal(effective.initiative, 0);
  assert.equal(effective.power, 250);
  assert.notEqual(effective, raw);
});
