import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCompleteBuild } from '../js/complete-build-evaluator.js';

const hit = {
  id: 'hit',
  name: 'Hit',
  apCost: 4,
  baseCritPct: 0,
  maxCastPerTurn: 2,
  maxCastPerTarget: 2,
  hits: [{ element: 'earth', normal: [20, 20], crit: [20, 20] }],
  combatModifiers: [],
  combatRelevant: true
};

const selections = [{
  enabled: true,
  weight: 1,
  spell: hit,
  casts: { 1: 1, 2: 0, 3: 0 }
}];

const temporaryDefense = {
  id: 'temporary-defense',
  name: 'Temporary defense',
  slot: 'hat',
  stats: { vit: 1000, resEarth: 10, earth: 100 },
  passives: [{
    id: 't1-defense',
    rules: [{
      trigger: { type: 'turn_in', turns: [1] },
      stats: { vit: 1000, resEarth: 20 }
    }]
  }],
  conditions: null
};

test('temporary T1 bonuses cannot rescue permanent Vita/resistance minimums', () => {
  const evaluation = evaluateCompleteBuild({
    items: [temporaryDefense],
    sets: [],
    selections,
    constraints: { ap: 12, mp: 6, vit: 2500, resEarth: 25 },
    fmPolicy: { spellDamagePct: 0, allowCritDamage: false, structuralExos: false },
    turnMode: 't1',
    scenario: { requiredApByTurn: {} },
    character: {
      level: 200,
      characteristicPoints: 0,
      scrolled: {},
      baseStats: { ap: 12, mp: 6, vit: 1000 }
    }
  });

  assert.equal(evaluation.result, null);
  assert.equal(evaluation.reason, 'constraint');
  assert.equal(evaluation.constraintDiagnostics.permanentDeficits.vit, 500);
  assert.equal(evaluation.constraintDiagnostics.permanentDeficits.resEarth, 15);
});

test('permanent defensive minimums still allow a legal T1 build', () => {
  const evaluation = evaluateCompleteBuild({
    items: [temporaryDefense],
    sets: [],
    selections,
    constraints: { ap: 12, mp: 6, vit: 2000, resEarth: 10 },
    fmPolicy: { spellDamagePct: 0, allowCritDamage: false, structuralExos: false },
    turnMode: 't1',
    scenario: { requiredApByTurn: {} },
    character: {
      level: 200,
      characteristicPoints: 0,
      scrolled: {},
      baseStats: { ap: 12, mp: 6, vit: 1000 }
    }
  });

  assert.ok(evaluation.result);
  assert.equal(evaluation.result.stats.vit, 2000);
  assert.equal(evaluation.result.stats.resEarth, 10);
  assert.equal(evaluation.result.effectiveStatsByTurn[1].vit, 3000);
  assert.equal(evaluation.result.effectiveStatsByTurn[1].resEarth, 30);
});
