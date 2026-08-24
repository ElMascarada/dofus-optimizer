import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCompleteBuild } from '../js/complete-build-evaluator.js';

const spell = { id: 's', name: 'S', baseCritPct: 0, hits: [{ element: 'earth', normal: [10, 10] }] };
const selections = [{ enabled: true, weight: 1, spell, casts: { 1: 1, 2: 0, 3: 0 } }];
const fmPolicy = { spellDamagePct: 3, allowCritDamage: false, critDamageAmount: 8, structuralExos: false };

test('equipment conditions are hard legality rules', () => {
  const trophy = {
    id: 'conditional-trophy',
    slot: 'dofus',
    stats: { ap: 1 },
    conditions: { kind: 'condition', stat: 'setBonus', operator: 'lt', value: 1 }
  };
  const items = [
    trophy,
    { id: 'a-1', slot: 'ring', setId: 'a', stats: {} },
    { id: 'a-2', slot: 'ring', setId: 'a', stats: {} }
  ];
  const sets = [{ id: 'a', name: 'A', bonuses: { '2': {} } }];

  const evaluation = evaluateCompleteBuild({
    items,
    sets,
    selections,
    constraints: {},
    fmPolicy,
    turnMode: 't1'
  });

  assert.equal(evaluation.result, null);
  assert.equal(evaluation.reason, 'item-condition');
});

test('turn feasibility is diagnostic and does not delete a benchmark build', () => {
  const evaluation = evaluateCompleteBuild({
    items: [{ id: 'hat', slot: 'hat', stats: { earth: 100 } }],
    sets: [],
    selections,
    constraints: { ap: 12, mp: 6 },
    fmPolicy,
    turnMode: 't1',
    scenario: { requiredApByTurn: { 1: 20 } }
  });

  assert.ok(evaluation.result);
  assert.ok(evaluation.result.warnings.includes('base-ap-mp') || evaluation.result.warnings.includes('turn-constraints'));
});
