import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCompleteBuild } from '../js/complete-build-evaluator.js';
import { evaluateTurnConstraints } from '../js/spells.js';

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
const unresolvedPassiveItem = {
  id: 'context-passive',
  name: 'Context Passive',
  slot: 'dofus',
  stats: {},
  passives: [{
    id: 'context-dependent-passive',
    rules: [{
      id: 'runtime-stacks',
      trigger: { type: 'context_compare', key: 'runtimeStacks', operator: 'gte', value: 1 },
      stats: { power: 50 }
    }]
  }],
  conditions: null
};
const oneCastSelections = [{ enabled: true, weight: 1, spell, casts: { 1: 1, 2: 0, 3: 0 } }];
const baseCharacter = {
  level: 200,
  characteristicPoints: 0,
  scrolled: {},
  baseStats: { ap: 12, mp: 6 }
};
const fmPolicy = { spellDamagePct: 3, allowCritDamage: false, critDamageAmount: 8, structuralExos: false };

test('permanent AP above the minimum is preserved while combat passives remain turn-aware', () => {
  const evaluation = evaluateCompleteBuild({
    items: [
      { id: 'hat', name: 'Hat', slot: 'hat', stats: { ap: 2, fire: 100 }, passives: [], conditions: null },
      prysma
    ],
    sets: [],
    selections,
    constraints: { ap: 12, mp: 6 },
    fmPolicy,
    turnMode: 't1',
    scenario: { requiredApByTurn: { 1: 15 } },
    character: {
      level: 200,
      characteristicPoints: 0,
      scrolled: {},
      baseStats: { ap: 11, mp: 6 }
    }
  });

  assert.ok(evaluation.result);
  assert.equal(evaluation.result.stats.ap, 13);
  assert.equal(evaluation.result.effectiveStatsByTurn[1].ap, 16);
  assert.equal(evaluation.result.effectiveStatsByTurn[2].ap, 13);

  const breakdown = evaluation.result.spellBreakdowns[0];
  assert.deepEqual(Object.keys(breakdown.perTurn), ['1', '2', '3']);
  assert.ok(breakdown.perTurn[1].expected > breakdown.perTurn[2].expected);
  assert.equal(breakdown.perTurn[2].expected, breakdown.perTurn[3].expected);
  assert.ok(breakdown.averageDamage > breakdown.perTurn[2].expected);
  assert.ok(breakdown.averageDamage < breakdown.perTurn[1].expected);
});

test('unresolved passive context stays observable without failing turn constraints', () => {
  const evaluation = evaluateTurnConstraints({
    stats: { ap: 12, mp: 6 },
    items: [unresolvedPassiveItem],
    constraints: { ap: 12, mp: 6 },
    selections: oneCastSelections,
    turnMode: 't1'
  });

  assert.equal(evaluation.meets, true);
  assert.deepEqual(evaluation.unresolvedPassiveContexts, ['runtimeStacks']);
  assert.deepEqual(evaluation.baseApMpMismatches, {});
  assert.deepEqual(evaluation.deficitsByTurn, {});
});

test('complete build warns about unresolved passive context without rejecting the build', () => {
  const evaluation = evaluateCompleteBuild({
    items: [unresolvedPassiveItem],
    sets: [],
    selections: oneCastSelections,
    constraints: { ap: 12, mp: 6 },
    fmPolicy,
    turnMode: 't1',
    character: baseCharacter
  });

  assert.ok(evaluation.result);
  assert.equal(evaluation.reason, null);
  assert.ok(evaluation.warnings.includes('unresolved-passive'));
  assert.ok(evaluation.result.warnings.includes('unresolved-passive'));
  assert.deepEqual(evaluation.result.unresolvedPassiveContexts, ['runtimeStacks']);
});

test('a real AP minimum deficit still rejects the complete build as a constraint failure', () => {
  const evaluation = evaluateCompleteBuild({
    items: [unresolvedPassiveItem],
    sets: [],
    selections: oneCastSelections,
    constraints: { ap: 12, mp: 6 },
    fmPolicy,
    turnMode: 't1',
    character: { ...baseCharacter, baseStats: { ap: 11, mp: 6 } }
  });

  assert.equal(evaluation.result, null);
  assert.equal(evaluation.reason, 'constraint');
});
