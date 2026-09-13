import test from 'node:test';
import assert from 'node:assert/strict';

import { retainFinalArchitectureCandidates } from '../optimizer/combined-set-core-search.js';

function item(id, slot, stats = {}) {
  return { id, slot, stats };
}

function state(name, score, items) {
  return {
    items,
    cores: [],
    score,
    meanScore: score,
    completionScore: score,
    constraintSignal: 0,
    pattern: name
  };
}

const context = {
  setsById: {},
  fmPolicy: {},
  constraints: { ap: 12, mp: 6 },
  specialistKeys: []
};

test('final architecture retention carries one-slot-from-complete lineages into completion', () => {
  const highA = state('high-a', 1000, [item('ha', 'hat', { power: 100 })]);
  const highB = state('high-b', 900, [item('hb', 'hat', { power: 90 })]);
  const highC = state('high-c', 800, [item('hc', 'hat', { power: 80 })]);

  const nearComplete = state('3+3+2', 1, [
    item('n-hat', 'hat'),
    item('n-cape', 'cape'),
    item('n-amulet', 'amulet'),
    item('n-ring-1', 'ring'),
    item('n-ring-2', 'ring'),
    item('n-belt', 'belt'),
    item('n-boots', 'boots'),
    item('n-weapon', 'weapon')
  ]);

  const retained = retainFinalArchitectureCandidates([highA, highB, highC, nearComplete], 2, context);
  assert.ok(retained.some((entry) => entry.pattern === '3+3+2'));
});
