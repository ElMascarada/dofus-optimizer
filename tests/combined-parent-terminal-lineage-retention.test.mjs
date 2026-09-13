import assert from 'node:assert/strict';
import test from 'node:test';

import { retainCombinedArchitectureStates } from '../optimizer/combined-set-core-search.js';

function makeState(parentIndex, variantIndex, score) {
  const parentSetId = `parent-${parentIndex}`;
  const terminalSetId = 'terminal-mekamouth-like';
  return {
    cores: [
      { setId: parentSetId },
      { setId: terminalSetId }
    ],
    items: [
      { id: `p-${parentIndex}-${variantIndex}`, stats: {} },
      { id: `t-${parentIndex}-${variantIndex}`, stats: {} }
    ],
    stats: {},
    score,
    meanScore: score,
    completionScore: score,
    constraintSignal: 0
  };
}

test('combined architecture retention preserves distinct parent -> terminal set lineages beyond scalar top-N duplicates', () => {
  const states = [];
  let score = 10000;
  for (let parent = 0; parent < 60; parent++) {
    for (let variant = 0; variant < 3; variant++) {
      states.push(makeState(parent, variant, score--));
    }
  }

  const targetParent = 'parent-49';
  const targetStates = states.filter((state) => String(state.cores[0].setId) === targetParent);
  const rankedTargetIndex = states.findIndex((state) => state === targetStates[0]);
  assert.ok(rankedTargetIndex >= 120, 'fixture puts target lineage outside scalar top-120');

  const retained = retainCombinedArchitectureStates(states, 120, {
    setsById: {},
    fmPolicy: {},
    constraints: {},
    specialistKeys: []
  });

  assert.equal(retained.length, 120);
  assert.ok(retained.some((state) => String(state.cores[0]?.setId) === targetParent
    && String(state.cores.at(-1)?.setId) === 'terminal-mekamouth-like'),
  'distinct parent lineage should survive even when duplicate variants rank above it');
});
