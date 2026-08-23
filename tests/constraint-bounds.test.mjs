import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildConstraintBundles,
  buildFutureConstraintBundleCaps,
  canMeetJointConstraintBundles
} from '../js/constraint-bounds.js';

test('joint resistance bound rejects a slot that can satisfy each resistance separately but not together', () => {
  const constraints = { resEarth: 40, resFire: 40 };
  const bundles = buildConstraintBundles(constraints);
  const groups = [{
    id: 'hat',
    count: 1,
    dynamic: false,
    choices: [
      { stats: { resEarth: 40, resFire: 0 } },
      { stats: { resEarth: 0, resFire: 40 } }
    ]
  }];
  const future = buildFutureConstraintBundleCaps(groups, bundles);
  assert.equal(canMeetJointConstraintBundles({
    rawStats: {},
    bundles,
    futureCaps: future[0],
    setUpper: {},
    charUpper: {},
    fmUpper: {}
  }), false);
});

test('joint resistance bound keeps a feasible balanced choice', () => {
  const constraints = { resEarth: 40, resFire: 40 };
  const bundles = buildConstraintBundles(constraints);
  const groups = [{
    id: 'hat',
    count: 1,
    dynamic: false,
    choices: [
      { stats: { resEarth: 40, resFire: 40 } },
      { stats: { resEarth: 80, resFire: 0 } }
    ]
  }];
  const future = buildFutureConstraintBundleCaps(groups, bundles);
  assert.equal(canMeetJointConstraintBundles({
    rawStats: {},
    bundles,
    futureCaps: future[0],
    setUpper: {},
    charUpper: {},
    fmUpper: {}
  }), true);
});

test('dynamic multi-pick group bound is optimistic and never understates a legal pair', () => {
  const constraints = { resEarth: 40, resFire: 40 };
  const bundles = buildConstraintBundles(constraints);
  const groups = [{
    id: 'dofus',
    count: 2,
    dynamic: true,
    candidates: [
      { stats: { resEarth: 40 } },
      { stats: { resFire: 40 } },
      { stats: { resEarth: 10, resFire: 10 } }
    ]
  }];
  const future = buildFutureConstraintBundleCaps(groups, bundles);
  assert.equal(canMeetJointConstraintBundles({
    rawStats: {},
    bundles,
    futureCaps: future[0],
    setUpper: {},
    charUpper: {},
    fmUpper: {}
  }), true);
});

test('dynamic hard-choice frontier prevents mutually incompatible per-item maxima from inflating the joint bound', () => {
  const constraints = { resEarth: 40, resFire: 40 };
  const bundles = buildConstraintBundles(constraints);
  const groups = [{
    id: 'dofus',
    count: 2,
    dynamic: true,
    candidates: [
      { stats: { resEarth: 40 } },
      { stats: { resFire: 40 } }
    ],
    hardConstraintChoices: [
      { stats: { resEarth: 40, resFire: 0 } },
      { stats: { resEarth: 0, resFire: 40 } }
    ]
  }];
  const future = buildFutureConstraintBundleCaps(groups, bundles);
  assert.equal(canMeetJointConstraintBundles({
    rawStats: {},
    bundles,
    futureCaps: future[0],
    setUpper: {},
    charUpper: {},
    fmUpper: {}
  }), false);
});