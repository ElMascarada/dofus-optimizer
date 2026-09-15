import assert from 'node:assert/strict';
import test from 'node:test';

import { retainCombinedArchitectureStates } from '../optimizer/combined-set-core-search.js';

function makeState(index, counter) {
  const item = { id: `item-${index}` };
  Object.defineProperty(item, 'stats', {
    enumerable: true,
    get() {
      counter.reads++;
      return {
        ap: index % 5 === 0 ? 1 : 0,
        mp: index % 7 === 0 ? 1 : 0
      };
    }
  });

  return {
    cores: [],
    items: [item],
    stats: {},
    score: 10000 - index,
    meanScore: 10000 - index,
    completionScore: 10000 - index,
    constraintSignal: 0
  };
}

test('combined retention computes contextual structural and bucket values at most once per item identity and lane', () => {
  const counter = { reads: 0 };
  const states = Array.from({ length: 180 }, (_, index) => makeState(index, counter));
  const limit = 120;

  const retained = retainCombinedArchitectureStates(states, limit, {
    setsById: {},
    fmPolicy: {},
    constraints: { ap: 12, mp: 6 },
    specialistKeys: []
  });

  assert.equal(retained.length, limit);
  assert.ok(
    counter.reads <= states.length + limit,
    `contextual item stats should be read at most once for structural progress and once for bucket retention per relevant state; got ${counter.reads}`
  );
});
