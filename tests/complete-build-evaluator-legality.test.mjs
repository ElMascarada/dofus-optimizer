import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCompleteBuild } from '../js/complete-build-evaluator.js';

const spell = { id: 's', name: 'S', apCost: 2, baseCritPct: 0, hits: [{ element: 'earth', normal: [10, 10] }] };
const selections = [{ enabled: true, weight: 1, spell, casts: { 1: 1, 2: 0, 3: 0 } }];
const fmPolicy = { spellDamagePct: 3, allowCritDamage: false, critDamageAmount: 8, structuralExos: false };
const legacyStructuralFmPolicy = { spellDamagePct: 3, allowCritDamage: false, critDamageAmount: 8, exoAp: 1, exoMp: 1 };

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

test('user constraints are hard legality rules instead of warnings', () => {
  const evaluation = evaluateCompleteBuild({
    items: [{ id: 'hat', slot: 'hat', stats: { earth: 100 } }],
    sets: [],
    selections,
    constraints: { ap: 12, mp: 6 },
    fmPolicy,
    turnMode: 't1',
    scenario: { requiredApByTurn: {} }
  });

  assert.equal(evaluation.result, null);
  assert.equal(evaluation.reason, 'constraint');
});

test('AP and MP constraints are minimums and do not cap a stronger build', () => {
  const evaluation = evaluateCompleteBuild({
    items: [{ id: 'hat', slot: 'hat', stats: { ap: 4, mp: 2, earth: 100 } }],
    sets: [],
    selections,
    constraints: { ap: 11, mp: 5 },
    fmPolicy: legacyStructuralFmPolicy,
    turnMode: 't1',
    scenario: { requiredApByTurn: {} }
  });

  assert.ok(evaluation.result, `expected 12/6 to satisfy 11/5, got ${evaluation.reason}`);
  assert.equal(evaluation.result.stats.ap, 12);
  assert.equal(evaluation.result.stats.mp, 6);
});

test('a Ganymede-style odd-turn AP/MP loss obeys the selected minimum', () => {
  const ganymedeLike = {
    id: 'ganymede-like',
    slot: 'hat',
    stats: { ap: 4, mp: 2, earth: 100 },
    passives: [{
      id: 'ganymede-cycle-test',
      rules: [{
        trigger: { type: 'turn_parity', parity: 'odd' },
        stats: { ap: -1, mp: -1 }
      }]
    }]
  };

  const strict = evaluateCompleteBuild({
    items: [ganymedeLike],
    sets: [],
    selections,
    constraints: { ap: 12, mp: 6 },
    fmPolicy: legacyStructuralFmPolicy,
    turnMode: 't1',
    scenario: { requiredApByTurn: {} }
  });
  assert.equal(strict.result, null);
  assert.equal(strict.reason, 'constraint');

  const relaxed = evaluateCompleteBuild({
    items: [ganymedeLike],
    sets: [],
    selections,
    constraints: { ap: 11, mp: 5 },
    fmPolicy: legacyStructuralFmPolicy,
    turnMode: 't1',
    scenario: { requiredApByTurn: {} }
  });
  assert.ok(relaxed.result, `expected Ganymede-like 11/5 T1 to satisfy 11/5, got ${relaxed.reason}`);
  assert.equal(relaxed.result.stats.ap, 12);
  assert.equal(relaxed.result.stats.mp, 6);
  assert.equal(relaxed.result.effectiveStatsByTurn[1].ap, 11);
  assert.equal(relaxed.result.effectiveStatsByTurn[1].mp, 5);
});

test('an elemental item condition can be satisfied by reallocating characteristic points', () => {
  const conditional = {
    id: 'fire-condition-item',
    slot: 'hat',
    stats: { fire: 150, earth: 80 },
    conditions: { kind: 'condition', stat: 'fire', operator: 'gt', value: 300 }
  };

  const evaluation = evaluateCompleteBuild({
    items: [conditional],
    sets: [],
    selections,
    constraints: {},
    fmPolicy,
    turnMode: 't1'
  });

  assert.ok(evaluation.result, `expected build to be repaired, got ${evaluation.reason}`);
  assert.equal(evaluation.result.itemConditionsSatisfied, true);
  assert.ok(evaluation.result.characteristics.fire >= 51);
  assert.ok(evaluation.result.stats.fire > 300);
});
