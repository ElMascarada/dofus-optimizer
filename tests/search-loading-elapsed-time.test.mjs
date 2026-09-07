import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  formatSearchDuration,
  SearchElapsedTimer
} from '../js/search-loading-elapsed-time.js';

function fakeTimerHarness() {
  let now = 0;
  let tick = null;
  let cleared = false;
  const states = [];
  const timer = new SearchElapsedTimer({
    now: () => now,
    setIntervalFn(callback) {
      tick = callback;
      return 7;
    },
    clearIntervalFn(id) {
      assert.equal(id, 7);
      cleared = true;
    },
    onChange(state) {
      states.push(state);
    }
  });
  return {
    timer,
    states,
    setNow(value) { now = value; },
    tick() { tick?.(); },
    wasCleared() { return cleared; }
  };
}

test('duration formatter stays compact under one minute and readable above one minute', () => {
  assert.equal(formatSearchDuration(0), '0.0 s');
  assert.equal(formatSearchDuration(12_340), '12.3 s');
  assert.equal(formatSearchDuration(59_999), '60.0 s');
  assert.equal(formatSearchDuration(72_400), '1 min 12 s');
  assert.equal(formatSearchDuration(125_000), '2 min 5 s');
});

test('search timing state goes loading true at start, elapsed grows, then loading false with final duration', () => {
  const harness = fakeTimerHarness();

  const started = harness.timer.start();
  assert.equal(started.loading, true);
  assert.equal(started.elapsedMs, 0);
  assert.equal(started.finalDurationMs, null);

  harness.setNow(1_250);
  harness.tick();
  assert.equal(harness.timer.snapshot().loading, true);
  assert.equal(harness.timer.snapshot().elapsedMs, 1_250);

  harness.setNow(18_740);
  const finished = harness.timer.finish();
  assert.equal(finished.loading, false);
  assert.equal(finished.elapsedMs, 18_740);
  assert.equal(finished.finalDurationMs, 18_740);
  assert.equal(harness.wasCleared(), true);
});

test('a new run restarts live elapsed at zero and replaces the previous duration only when it finishes', () => {
  const harness = fakeTimerHarness();
  harness.timer.start();
  harness.setNow(5_000);
  harness.timer.finish();
  assert.equal(harness.timer.snapshot().finalDurationMs, 5_000);

  harness.setNow(10_000);
  const restarted = harness.timer.start();
  assert.equal(restarted.loading, true);
  assert.equal(restarted.elapsedMs, 0);
  assert.equal(restarted.finalDurationMs, 5_000);

  harness.setNow(12_500);
  const finished = harness.timer.finish();
  assert.equal(finished.finalDurationMs, 2_500);
});

test('final duration is result-agnostic and remains available for a zero-result completion', () => {
  const harness = fakeTimerHarness();
  const output = { results: [] };
  assert.equal(output.results.length, 0);

  harness.timer.start();
  harness.setNow(3_600);
  const finished = harness.timer.finish();

  assert.equal(finished.loading, false);
  assert.equal(finished.finalDurationMs, 3_600);
  assert.equal(formatSearchDuration(finished.finalDurationMs), '3.6 s');
});

test('elapsed-time UX stays outside search payload and worker business logic', async () => {
  const source = await readFile(new URL('../js/search-loading-elapsed-time.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /postMessage\s*\(/);
  assert.doesNotMatch(source, /new Worker\s*\(/);
  assert.doesNotMatch(source, /optimizer-worker\.js/);
  assert.doesNotMatch(source, /createOptimizerV2Request/);
  assert.doesNotMatch(source, /score|constraint|heuristic/i);
});
