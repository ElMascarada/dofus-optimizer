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

const character = {
  level: 200,
  characteristicPoints: 0,
  scrolled: {},
  baseStats: { ap: 11, mp: 6 }
};

function evaluate(requiredAp = 15) {
  return evaluateCompleteBuild({
    items: [
      { id: 'hat', name: 'Hat', slot: 'hat', stats: { ap: 2, fire: 100 }, passives: [], conditions: null },
      prysma
    ],
    sets: [],
    selections,
    constraints: { ap: 12, mp: 6 },
    fmPolicy: { spellDamagePct: 3, allowCritDamage: false, critDamageAmount: 8, structuralExos: false },
    turnMode: 't1',
    scenario: { requiredApByTurn: { 1: requiredAp } },
    character
  });
}

test('permanent AP is capped at 12 while combat passives and spell display remain turn-aware', () => {
  const evaluation = evaluate(15);

  assert.ok(evaluation.result);
  assert.equal(evaluation.result.stats.ap, 12);
  assert.equal(evaluation.result.effectiveStatsByTurn[1].ap, 15);
  assert.equal(evaluation.result.effectiveStatsByTurn[2].ap, 12);

  const breakdown = evaluation.result.spellBreakdowns[0];
  assert.deepEqual(Object.keys(breakdown.perTurn), ['1', '2', '3']);
  assert.ok(breakdown.perTurn[1].expected > breakdown.perTurn[2].expected);
  assert.equal(breakdown.perTurn[2].expected, breakdown.perTurn[3].expected);
  assert.ok(breakdown.averageDamage > breakdown.perTurn[2].expected);
  assert.ok(breakdown.averageDamage < breakdown.perTurn[1].expected);
});

test('manual requested combo exposes every cast in the turn plan shown by the UI', () => {
  const evaluation = evaluate(15);
  const plan = evaluation.result.combatPlan;

  assert.equal(plan.kind, 'requested-combo');
  assert.deepEqual(plan.objective.activeTurns, [1]);
  assert.equal(plan.availableApByTurn[1], 15);
  assert.equal(plan.sequence.length, 3);
  assert.deepEqual(plan.sequence.map((entry) => entry.name), ['Burst', 'Burst', 'Burst']);
  assert.deepEqual(plan.sequence.map((entry) => entry.apCost), [5, 5, 5]);
  assert.equal(
    plan.sequence.reduce((sum, entry) => sum + entry.expectedDamage, 0),
    evaluation.result.perTurn[1]
  );
});

test('an impossible requested turn is rejected instead of being ranked with a turn-constraints warning', () => {
  const evaluation = evaluate(20);

  assert.equal(evaluation.result, null);
  assert.equal(evaluation.reason, 'turn-constraints');
});

test('automatic pre-ranking can use synthetic all-spell selections without pretending they must all fit in one turn', () => {
  const automatic = evaluateCompleteBuild({
    items: [
      { id: 'hat', name: 'Hat', slot: 'hat', stats: { ap: 2, fire: 100 }, passives: [], conditions: null }
    ],
    sets: [],
    selections: [
      { enabled: true, weight: 1, spell, casts: { 1: 4, 2: 0, 3: 0 } },
      { enabled: true, weight: 1, spell: { ...spell, id: 'burst-2', name: 'Burst 2' }, casts: { 1: 4, 2: 0, 3: 0 } }
    ],
    constraints: { ap: 12, mp: 6 },
    fmPolicy: { spellDamagePct: 0, allowCritDamage: false, critDamageAmount: 8, structuralExos: false },
    turnMode: 't1',
    scenario: { requiredApByTurn: {} },
    character
  });

  assert.ok(automatic.result);
  assert.equal(automatic.result.combatPlan, undefined);
});
