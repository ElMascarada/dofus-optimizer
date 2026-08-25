import test from 'node:test';
import assert from 'node:assert/strict';
import { refineCombatTurns } from '../js/combat-turn-refiner.js';

const hit = {
  id: 'earth-hit',
  name: 'Earth hit',
  apCost: 4,
  baseCritPct: 0,
  maxCastPerTurn: 3,
  maxCastPerTarget: 3,
  distanceOptions: ['melee', 'ranged'],
  hits: [{ element: 'earth', normal: [30, 30], crit: [30, 30] }],
  combatModifiers: [],
  combatRelevant: true
};

function build(index) {
  const stats = { ap: 12, mp: 6, earth: 100 + index };
  return {
    score: index,
    stats,
    effectiveStatsByTurn: {
      1: { ...stats },
      2: { ...stats },
      3: { ...stats }
    },
    items: [{ id: `item-${index}`, name: `Item ${index}`, slot: 'hat', stats: {} }]
  };
}

test('T1+T2+T3 keeps a combatPlan on every returned result, including coarse-only tail candidates', () => {
  const output = refineCombatTurns({
    results: Array.from({ length: 25 }, (_, index) => build(index)),
    spells: [hit],
    combatObjective: {
      turnMode: 'sum',
      targetMode: 'single',
      allowSupport: true,
      metric: 'total-damage'
    },
    topN: 20
  });

  assert.equal(output.results.length, 20);
  assert.equal(output.diagnostics.preciseCandidates, 18);

  for (const result of output.results) {
    assert.ok(result.combatPlan, 'missing combatPlan');
    assert.deepEqual(result.combatPlan.objective.activeTurns, [1, 2, 3]);
    assert.ok(result.combatPlan.sequence.length >= 9, 'expected actions across all three turns');
    assert.ok(result.perTurn[1] > 0, 'missing T1 damage');
    assert.ok(result.perTurn[2] > 0, 'missing T2 damage');
    assert.ok(result.perTurn[3] > 0, 'missing T3 damage');
  }
});
