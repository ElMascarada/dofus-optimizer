import assert from 'node:assert/strict';
import test from 'node:test';

import { packageCanClosePermanentResources } from '../optimizer/dofus-package-refiner-fast.js';

test('exact Dofus refinement evaluates only the AP/MP bucket that can close a 12/6 build', () => {
  const base = { ap: 11, mp: 5 };
  const constraints = { ap: 12, mp: 6 };

  assert.equal(packageCanClosePermanentResources({ ap: 1, mp: 1 }, base, constraints), true);
  assert.equal(packageCanClosePermanentResources({ ap: 0, mp: 1 }, base, constraints), false);
  assert.equal(packageCanClosePermanentResources({ ap: 1, mp: 0 }, base, constraints), false);
  assert.equal(packageCanClosePermanentResources({ ap: 2, mp: 1 }, base, constraints), false);
  assert.equal(packageCanClosePermanentResources({ ap: 1, mp: 2 }, base, constraints), false);
});

test('resource pruning preserves a legal zero-resource package when the base already closes 12/6', () => {
  const base = { ap: 12, mp: 6 };
  const constraints = { ap: 12, mp: 6 };

  assert.equal(packageCanClosePermanentResources({ ap: 0, mp: 0 }, base, constraints), true);
  assert.equal(packageCanClosePermanentResources({ ap: 1, mp: 0 }, base, constraints), false);
  assert.equal(packageCanClosePermanentResources({ ap: 0, mp: 1 }, base, constraints), false);
});

test('resource pruning follows the requested lower bounds without inventing a 12/6 minimum', () => {
  const base = { ap: 11, mp: 5 };
  const constraints = { ap: 11, mp: 5 };

  assert.equal(packageCanClosePermanentResources({ ap: 0, mp: 0 }, base, constraints), true);
});
