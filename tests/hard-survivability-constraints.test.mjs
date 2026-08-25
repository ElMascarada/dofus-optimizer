import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCompleteBuild } from '../js/complete-build-evaluator.js';

const spell = {
  id: 'test-hit',
  name: 'Test hit',
  apCost: 4,
  baseCritPct: 0,
  hits: [{ element: 'earth', normal: [10, 10], crit: [10, 10] }]
};

const selections = [{ enabled: true, weight: 1, spell, casts: { 1: 1, 2: 0, 3: 0 } }];
const fmPolicy = { spellDamagePct: 0, allowCritDamage: false, critDamageAmount: 8, structuralExos: false };
const character = {
  level: 200,
  characteristicPoints: 0,
  scrolled: {},
  baseStats: { ap: 12, mp: 6, vit: 4900, resEarth: 10 }
};

test('temporary T1 vitality and resistance bonuses cannot rescue a permanently invalid stuff', () => {
  const temporaryTank = {
    id: 'temporary-tank',
    name: 'Temporary tank',
    slot: 'dofus',
    slotSubtype: 'prysmaradite',
    stats: {},
    conditions: null,
    passives: [{
      id: 'temporary-survivability',
      rules: [{
        trigger: { type: 'turn_in', turns: [1] },
        stats: { vit: 200, resEarth: 20 }
      }]
    }]
  };

  const evaluation = evaluateCompleteBuild({
    items: [temporaryTank],
    sets: [],
    selections,
    constraints: { ap: 12, mp: 6, vit: 5000, resEarth: 30 },
    fmPolicy,
    turnMode: 't1',
    scenario: { requiredApByTurn: {} },
    character
  });

  assert.equal(evaluation.result, null);
  assert.equal(evaluation.reason, 'constraint');
  assert.equal(evaluation.constraintDiagnostics.staticConstraintDeficits.vit, 100);
  assert.equal(evaluation.constraintDiagnostics.staticConstraintDeficits.resEarth, 20);
});

test('permanent vitality and resistance meeting the floor remain valid', () => {
  const permanentTank = {
    id: 'permanent-tank',
    name: 'Permanent tank',
    slot: 'hat',
    stats: { vit: 100, resEarth: 20, earth: 50 },
    conditions: null,
    passives: []
  };

  const evaluation = evaluateCompleteBuild({
    items: [permanentTank],
    sets: [],
    selections,
    constraints: { ap: 12, mp: 6, vit: 5000, resEarth: 30 },
    fmPolicy,
    turnMode: 't1',
    scenario: { requiredApByTurn: {} },
    character
  });

  assert.ok(evaluation.result);
  assert.equal(evaluation.result.stats.vit, 5000);
  assert.equal(evaluation.result.stats.resEarth, 30);
});
