import test from 'node:test';
import assert from 'node:assert/strict';
import { refineCombatTurns } from '../js/combat-turn-refiner.js';

const hit = {
  id: 'hit',
  name: 'Hit',
  apCost: 4,
  baseCritPct: 0,
  maxCastPerTurn: 3,
  maxCastPerTarget: 3,
  hits: [{ element: 'earth', normal: [30, 30], crit: [30, 30] }],
  combatModifiers: [],
  combatRelevant: true
};

function build(index) {
  return {
    score: 1000 - index,
    items: [{ id: `item-${index}`, slot: 'hat', stats: {} }],
    stats: { ap: 12, earth: 100 + index },
    effectiveStatsByTurn: {
      1: { ap: 12, earth: 100 + index },
      2: { ap: 12, earth: 100 + index },
      3: { ap: 12, earth: 100 + index }
    }
  };
}

test('T1+T2+T3 preselects a bounded gear bench before expensive rotation solving', () => {
  const input = Array.from({ length: 80 }, (_, index) => build(index));
  const output = refineCombatTurns({
    results: input,
    spells: [hit],
    combatObjective: { turnMode: 'sum', allowSupport: true, metric: 'total-damage' },
    topN: 30,
    preservePrysmaradites: true
  });

  assert.equal(output.diagnostics.inputCandidates, 80);
  assert.ok(output.diagnostics.preselectedCandidates <= 36, `expected <=36 preselected builds, got ${output.diagnostics.preselectedCandidates}`);
  assert.ok(output.diagnostics.preciseEvaluated <= 14, `expected <=14 precise rotations, got ${output.diagnostics.preciseEvaluated}`);
  assert.ok(output.diagnostics.inputPruned >= 44);
  assert.ok(output.results.length > 0);
  for (const result of output.results) {
    assert.deepEqual(Object.keys(result.perTurn), ['1', '2', '3']);
    assert.deepEqual(result.combatPlan.objective.activeTurns, [1, 2, 3]);
  }
});
