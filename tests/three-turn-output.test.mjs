import test from 'node:test';
import assert from 'node:assert/strict';
import { refineCombatTurns } from '../js/combat-turn-refiner.js';
import { combatPlanIsComplete } from '../js/final-result-validator.js';

const spell = {
  id: 'three-turn-hit',
  name: 'Three turn hit',
  apCost: 4,
  baseCritPct: 0,
  maxCastPerTurn: 2,
  maxCastPerTarget: 2,
  hits: [{ element: 'earth', normal: [50, 50], crit: [50, 50] }],
  combatModifiers: [],
  combatRelevant: true,
  distanceOptions: ['melee', 'ranged']
};

const build = {
  items: [{ id: 'hat', name: 'Hat', slot: 'hat', stats: {}, passives: [] }],
  score: 1,
  stats: { ap: 8, mp: 6, earth: 100 },
  effectiveStatsByTurn: {
    1: { ap: 8, mp: 6, earth: 100 },
    2: { ap: 8, mp: 6, earth: 100 },
    3: { ap: 8, mp: 6, earth: 100 }
  }
};

test('sum mode never returns a combat result without explicit T1 T2 T3 damage', () => {
  const output = refineCombatTurns({
    results: [build],
    spells: [spell],
    combatObjective: {
      turnMode: 'sum',
      allowSupport: true,
      targetMode: 'single',
      metric: 'total-damage'
    },
    topN: 1
  });

  assert.equal(output.results.length, 1);
  const result = output.results[0];
  assert.equal(combatPlanIsComplete(result, 'sum'), true);
  assert.deepEqual(Object.keys(result.perTurn), ['1', '2', '3']);
  assert.ok(result.perTurn[1] > 0);
  assert.ok(result.perTurn[2] > 0);
  assert.ok(result.perTurn[3] > 0);
  assert.deepEqual(result.combatPlan.objective.activeTurns, [1, 2, 3]);
});
