import test from 'node:test';
import assert from 'node:assert/strict';
import {
  searchConstraintCompletenessRescue,
  shouldUseConstraintCompletenessRescue
} from '../js/constraint-completeness-rescue.js';
import { searchArchitecturesV2 } from '../js/architecture-search-v2.js';

const fireSpell = {
  id: 'rescue-fire',
  name: 'Rescue fire',
  apCost: 3,
  baseCritPct: 0,
  hits: [{ element: 'fire', normal: [30, 30], crit: [30, 30] }]
};

const selections = [{
  enabled: true,
  weight: 1,
  spell: fireSpell,
  casts: { 1: 1, 2: 0, 3: 0 }
}];

function item(id, slot, stats = {}, extra = {}) {
  return {
    id,
    name: id,
    level: 200,
    slot,
    setId: null,
    stats,
    passives: [],
    conditions: null,
    slotSubtype: null,
    typeName: slot,
    ...extra
  };
}

function fixedShape({ hats, companions = [item('companion', 'companion', { fire: 10 })] } = {}) {
  return [
    ...(hats || [item('hat', 'hat', { fire: 10 })]),
    item('cape', 'cape', { ap: 1, fire: 10 }),
    item('amulet', 'amulet', { ap: 1, fire: 10 }),
    item('ring-a', 'ring', { fire: 10 }),
    item('ring-b', 'ring', { fire: 10 }),
    item('belt', 'belt', { fire: 10 }),
    item('boots', 'boots', { fire: 10 }),
    item('weapon', 'weapon', { ap: 1, fire: 10 }),
    item('shield', 'shield', { ap: 1, fire: 10 }),
    ...companions,
    ...Array.from({ length: 6 }, (_, index) => item(`dofus-${index + 1}`, 'dofus', { fire: 5 }, { typeName: 'Dofus' }))
  ];
}

function rescueOptions(items, constraints) {
  return {
    items,
    sets: [],
    selections,
    constraints,
    fmPolicy: { spellDamagePct: 0, allowCritDamage: false, critDamageAmount: 8, exoAp: 0, exoMp: 0 },
    turnMode: 't1',
    scenario: { requiredApByTurn: {} },
    searchProfile: 'BALANCED'
  };
}

function runRescue(items, constraints) {
  return searchConstraintCompletenessRescue(rescueOptions(items, constraints));
}

function ids(build) {
  return new Set((build?.items || []).map((entry) => String(entry.id)));
}

test('generic rescue ignores stronger invalid offense and returns the best objective among multiple AP-valid builds', () => {
  const items = fixedShape({
    hats: [
      item('invalid-offense', 'hat', { fire: 500 }),
      item('valid-low', 'hat', { ap: 1, fire: 30 }),
      item('valid-high', 'hat', { ap: 1, fire: 60 })
    ]
  });

  const output = runRescue(items, { ap: 12 });
  assert.equal(output.results.length, 1);
  assert.ok(ids(output.results[0]).has('valid-high'));
  assert.ok(!ids(output.results[0]).has('invalid-offense'));
  assert.ok(output.diagnostics.constraintRescueValid >= 2, 'both valid lower-offense lineages must remain reachable');
  assert.equal(output.diagnostics.constraintRescueUsed, true);
  assert.equal(output.diagnostics.constraintRescueExhausted, true);
});

test('a canonical final scorer, not equipment ranking, selects the rescue T1 incumbent', () => {
  const items = fixedShape({
    hats: [
      item('invalid-offense', 'hat', { fire: 500 }),
      item('valid-low', 'hat', { ap: 1, fire: 30 }),
      item('valid-high', 'hat', { ap: 1, fire: 60 })
    ]
  });

  const output = searchConstraintCompletenessRescue({
    ...rescueOptions(items, { ap: 12 }),
    useOffensiveBound: false,
    scoreValidBuild(build) {
      return { ...build, score: ids(build).has('valid-low') ? 900 : 100 };
    }
  });

  assert.equal(output.results.length, 1);
  assert.ok(ids(output.results[0]).has('valid-low'), 'final product T1 scoring must be allowed to disagree with equipment ranking');
  assert.ok(output.diagnostics.constraintRescueValid >= 2);
});

test('the same rescue mechanism protects a Vitality minimum without stat-specific branching', () => {
  const items = fixedShape({
    hats: [item('ap-hat', 'hat', { ap: 1, fire: 10 })],
    companions: [
      item('invalid-vit-offense', 'companion', { fire: 500 }),
      item('valid-vit-low', 'companion', { vit: 600, fire: 30 }),
      item('valid-vit-high', 'companion', { vit: 600, fire: 60 })
    ]
  });

  const output = runRescue(items, { vit: 2500 });
  assert.equal(output.results.length, 1);
  assert.ok(ids(output.results[0]).has('valid-vit-high'));
  assert.ok(!ids(output.results[0]).has('invalid-vit-offense'));
  assert.ok(Number(output.results[0].stats?.vit || 0) >= 2500);
  assert.ok(output.diagnostics.constraintRescueValid >= 2);
});

test('a mathematically impossible minimum returns zero only after a certified upper-envelope failure', () => {
  const items = fixedShape({ hats: [item('ap-hat', 'hat', { ap: 1 })] });
  const output = runRescue(items, { range: 50 });

  assert.equal(output.results.length, 0);
  assert.equal(output.diagnostics.constraintRescueUsed, true);
  assert.equal(output.diagnostics.constraintRescueExhausted, true);
  assert.ok(output.diagnostics.constraintRescuePruned > 0);
  assert.equal(output.diagnostics.constraintRescueEvaluated, 0);
  assert.match(output.diagnostics.constraintRescueReason, /impossible/);
});

test('normal search keeps its winner and does not trigger rescue when a valid result already exists', () => {
  const items = fixedShape({
    hats: [
      item('normal-low', 'hat', { ap: 1, fire: 30 }),
      item('normal-high', 'hat', { ap: 1, fire: 80 })
    ]
  });
  const normal = searchArchitecturesV2({
    ...rescueOptions(items, { ap: 12 }),
    topN: 3
  });

  assert.ok(normal.results.length > 0);
  assert.ok(ids(normal.results[0]).has('normal-high'));
  assert.equal(shouldUseConstraintCompletenessRescue({ results: normal.results, constraints: { ap: 12 } }), false);
});

test('rescue trigger requires both zero results and at least one active minimum', () => {
  assert.equal(shouldUseConstraintCompletenessRescue({ results: [], constraints: { ap: 12 } }), true);
  assert.equal(shouldUseConstraintCompletenessRescue({ results: [{ items: [] }], constraints: { ap: 12 } }), false);
  assert.equal(shouldUseConstraintCompletenessRescue({ results: [], constraints: { ap: 0, vit: 0 } }), false);
});
