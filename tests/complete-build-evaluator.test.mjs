import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCompleteBuild } from '../js/complete-build-evaluator.js';

const spell = {
  id: 'burst',
  name: 'Burst',
  apCost: 5,
  baseCritPct: 0,
  hits: [{ element: 'fire', normal: [10, 10] }]
};

const selections = [{ enabled: true, weight: 1, spell, casts: { 1: 3, 2: 0, 3: 0 } }];
const prysma = {
  id: 'prysma',
  name: 'Prysmaradite',
  slot: 'dofus',
  slotSubtype: 'prysmaradite',
  stats: {},
  passives: [{
    id: 'ap-burst',
    rules: [{ trigger: { type: 'turn_in', turns: [1] }, stats: { ap: 3, finalDamagePct: 20 } }]
  }],
  conditions: null
};

const baseCharacter = {
  level: 200,
  characteristicPoints: 0,
  scrolled: {},
  baseStats: { ap: 11, mp: 6 }
};

const baseFm = { spellDamagePct: 3, allowCritDamage: false, critDamageAmount: 8, structuralExos: false };

test('permanent AP is capped at 12 while combat passives and spell display remain turn-aware', () => {
  const evaluation = evaluateCompleteBuild({
    items: [
      { id: 'hat', name: 'Hat', slot: 'hat', stats: { ap: 2, fire: 100 }, passives: [], conditions: null },
      prysma
    ],
    sets: [],
    selections,
    constraints: { ap: 12, mp: 6 },
    fmPolicy: baseFm,
    turnMode: 't1',
    scenario: { requiredApByTurn: { 1: 15 } },
    character: baseCharacter
  });

  assert.ok(evaluation.result);
  assert.equal(evaluation.result.stats.ap, 12);
  assert.equal(evaluation.result.effectiveStatsByTurn[1].ap, 15);
  assert.equal(evaluation.result.effectiveStatsByTurn[2].ap, 12);
  assert.equal(evaluation.result.objectiveMode, 'manual');
  assert.equal(evaluation.result.requestedTurnPlan.perTurn[1].apSpent, 15);
  assert.equal(evaluation.result.requestedTurnPlan.perTurn[1].actions[0].casts, 3);

  const breakdown = evaluation.result.spellBreakdowns[0];
  assert.deepEqual(Object.keys(breakdown.perTurn), ['1', '2', '3']);
  assert.ok(breakdown.perTurn[1].expected > breakdown.perTurn[2].expected);
  assert.equal(breakdown.perTurn[2].expected, breakdown.perTurn[3].expected);
  assert.ok(breakdown.averageDamage > breakdown.perTurn[2].expected);
  assert.ok(breakdown.averageDamage < breakdown.perTurn[1].expected);
});

test('manual benchmark rejects a requested turn that cannot actually be cast', () => {
  const evaluation = evaluateCompleteBuild({
    items: [{ id: 'hat', name: 'Hat', slot: 'hat', stats: { ap: 1, fire: 100 }, passives: [], conditions: null }],
    sets: [],
    selections,
    constraints: { ap: 12, mp: 6 },
    fmPolicy: baseFm,
    turnMode: 't1',
    scenario: { requiredApByTurn: { 1: 15 } },
    character: baseCharacter
  });

  assert.equal(evaluation.result, null);
  assert.equal(evaluation.reason, 'turn-constraints');
  assert.equal(evaluation.turnConstraints.deficitsByTurn[1].ap, 3);
});

test('automatic combat scoring does not mistake synthetic enabled spells for a 15 AP requested turn', () => {
  const evaluation = evaluateCompleteBuild({
    items: [{ id: 'hat', name: 'Hat', slot: 'hat', stats: { ap: 1, fire: 100 }, passives: [], conditions: null }],
    sets: [],
    selections,
    constraints: { ap: 12, mp: 6 },
    fmPolicy: baseFm,
    turnMode: 't1',
    scenario: { requiredApByTurn: {} },
    character: baseCharacter
  });

  assert.ok(evaluation.result);
  assert.equal(evaluation.result.objectiveMode, 'combat');
  assert.equal(evaluation.result.requestedTurnPlan, null);
  assert.equal(evaluation.result.turnFeasible, true);
  assert.equal(evaluation.result.warnings.includes('turn-constraints'), false);
});
