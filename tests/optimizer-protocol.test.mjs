import test from 'node:test';
import assert from 'node:assert/strict';

import {
  OPTIMIZER_MESSAGE,
  createOptimizeMessage,
  isOptimizerError,
  isOptimizerProgress,
  isOptimizerResult,
  optimizerMessageBelongsToRequest
} from '../js/optimizer-protocol.js';

test('optimizer protocol creates the existing optimize message shape', () => {
  const payload = { classId: 8, constraints: { ap: 12, mp: 6 } };
  assert.deepEqual(createOptimizeMessage(42, payload), {
    type: 'optimize',
    requestId: 42,
    payload
  });
  assert.equal(OPTIMIZER_MESSAGE.OPTIMIZE, 'optimize');
});

test('optimizer protocol classifies current worker messages without DOM knowledge', () => {
  assert.equal(isOptimizerProgress({ type: 'progress' }), true);
  assert.equal(isOptimizerResult({ type: 'result' }), true);
  assert.equal(isOptimizerError({ type: 'error' }), true);
  assert.equal(optimizerMessageBelongsToRequest({ requestId: 7 }, 7), true);
  assert.equal(optimizerMessageBelongsToRequest({ requestId: 8 }, 7), false);
});
