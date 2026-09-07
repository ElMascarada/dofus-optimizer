import test from 'node:test';
import assert from 'node:assert/strict';
import { createCandidatePolicy } from '../optimizer/candidate-policy.js';
import { searchConstraintCompletenessRescue } from '../js/constraint-completeness-rescue.js';
import { buildSetCoreFirstPlan } from '../js/set-core-first-exploration.js';

const EPSILON = 1e-9;

function item(id, slot, stats = {}, setId = null, extra = {}) {
  return {
    id, name: id, level: 200, slot, setId, stats,
    passives: [], effects: [], conditions: null, turnBonuses: {}, pendingDynamicEffects: [],
    slotSubtype: null, typeName: slot === 'companion' ? 'Familier' : slot === 'dofus' ? 'Dofus' : slot,
    certified: true, ...extra
  };
}

const fireSpell = {
  id: 'core-first-fire', name: 'Core first fire', apCost: 3, baseCritPct: 0,
  hits: [{ element: 'fire', normal: [30, 30], crit: [45, 45] }]
};
const waterSpell = {
  id: 'core-first-water', name: 'Core first water', apCost: 3, baseCritPct: 0,
  hits: [{ element: 'water', normal: [30, 30], crit: [45, 45] }]
};

function selections(multi = false) {
  return [
    { enabled: true, weight: 1, spell: fireSpell, casts: { 1: 1, 2: 0, 3: 0 } },
    ...(multi ? [{ enabled: true, weight: 1, spell: waterSpell, casts: { 1: 1, 2: 0, 3: 0 } }] : [])
  ];
}

function policyFor(items, sets, constraints = { ap: 12 }, multi = false) {
  return createCandidatePolicy({
    items, sets, selections: selections(multi), constraints, turnMode: 't1', scenario: {}, searchProfile: 'BALANCED'
  });
}

function sameFootprintFixture() {
  const items = [
    item('attack-hat', 'hat', { fire: 40 }, 'attack-set'),
    item('attack-cape', 'cape', { fire: 40 }, 'attack-set'),
    item('floor-hat', 'hat', { fire: 5 }, 'floor-set'),
    item('floor-cape', 'cape', { fire: 5 }, 'floor-set')
  ];
  const sets = [
    { id: 'attack-set', name: 'Attack', bonuses: { 2: { fire: 260 } } },
    { id: 'floor-set', name: 'Floor', bonuses: { 2: { fire: 10, range: 3 } } }
  ];
  return { items, sets };
}

test('core-first ordering explores the stronger same-footprint core first without deleting alternatives', () => {
  const { items, sets } = sameFootprintFixture();
  const plan = buildSetCoreFirstPlan({ policy: policyFor(items, sets), constraints: { ap: 12 }, setsById: Object.fromEntries(sets.map((set) => [set.id, set])) });
  assert.equal(plan.seeds[0]?.setId, 'attack-set');
  assert.ok(plan.seeds.some((seed) => seed.setId === 'floor-set'));
  assert.equal(plan.footprints, 1);
});

test('hard constraint reorders same-footprint cores without becoming T1 score', () => {
  const { items, sets } = sameFootprintFixture();
  const byId = Object.fromEntries(sets.map((set) => [set.id, set]));
  const unconstrained = buildSetCoreFirstPlan({ policy: policyFor(items, sets), constraints: { ap: 12 }, setsById: byId });
  const constrainedPolicy = policyFor(items, sets, { ap: 12, range: 3 });
  const constrained = buildSetCoreFirstPlan({ policy: constrainedPolicy, constraints: { ap: 12, range: 3 }, setsById: byId });

  assert.equal(unconstrained.seeds[0]?.setId, 'attack-set');
  assert.equal(constrained.seeds[0]?.setId, 'floor-set');
  const attack = constrained.seeds.find((seed) => seed.setId === 'attack-set');
  const floor = constrained.seeds.find((seed) => seed.setId === 'floor-set');
  assert.ok(Number(attack?.expectedT1Gain || 0) > Number(floor?.expectedT1Gain || 0), 'hard floor must reorder despite lower T1');
});

test('different footprints remain incomparable and both stay explorable', () => {
  const items = [
    item('alpha-hat', 'hat', { fire: 40 }, 'alpha'), item('alpha-cape', 'cape', { fire: 40 }, 'alpha'),
    item('beta-belt', 'belt', { fire: 35 }, 'beta'), item('beta-boots', 'boots', { fire: 35 }, 'beta')
  ];
  const sets = [
    { id: 'alpha', name: 'Alpha', bonuses: { 2: { fire: 120 } } },
    { id: 'beta', name: 'Beta', bonuses: { 2: { fire: 110 } } }
  ];
  const plan = buildSetCoreFirstPlan({ policy: policyFor(items, sets), constraints: { ap: 12 }, setsById: Object.fromEntries(sets.map((set) => [set.id, set])) });
  assert.equal(plan.footprints, 2);
  assert.ok(plan.seeds.some((seed) => seed.setId === 'alpha'));
  assert.ok(plan.seeds.some((seed) => seed.setId === 'beta'));
});

test('a weaker two-piece core with a strong future three-piece extension is never destructively removed by core-first ordering', () => {
  const items = [
    item('static-hat', 'hat', { fire: 100 }, 'static'), item('static-cape', 'cape', { fire: 100 }, 'static'),
    item('extension-hat', 'hat', { fire: 20 }, 'extension'), item('extension-cape', 'cape', { fire: 20 }, 'extension'),
    item('extension-belt', 'belt', { fire: 20 }, 'extension')
  ];
  const sets = [
    { id: 'static', name: 'Static', bonuses: { 2: { fire: 100 } } },
    { id: 'extension', name: 'Extension', bonuses: { 2: { fire: 10 }, 3: { fire: 900 } } }
  ];
  const plan = buildSetCoreFirstPlan({ policy: policyFor(items, sets), constraints: { ap: 12 }, setsById: Object.fromEntries(sets.map((set) => [set.id, set])) });
  assert.ok(plan.seeds.some((seed) => seed.setId === 'extension' && seed.pieceCount === 2));
  assert.ok(plan.seeds.some((seed) => seed.setId === 'extension' && seed.pieceCount === 3));
});

function fixedDofus() {
  return Array.from({ length: 6 }, (_, index) => item(`exact-dofus-${index}`, 'dofus', { power: 2 }));
}

function exactFixture() {
  const sets = [{ id: 'exact-set', name: 'Exact', bonuses: { 2: { power: 300, fire: 100, water: 100 } } }];
  const items = [
    item('core-hat', 'hat', { ap: 1, power: 20 }, 'exact-set'),
    item('standalone-hat', 'hat', { ap: 1, power: 110 }),
    item('core-cape', 'cape', { ap: 1, power: 20 }, 'exact-set'),
    item('standalone-cape', 'cape', { ap: 1, power: 105 }),
    item('exact-amulet', 'amulet', { ap: 1, power: 10 }),
    item('exact-ring-a', 'ring', { power: 10 }), item('exact-ring-b', 'ring', { power: 9 }),
    item('exact-belt', 'belt', { power: 10 }), item('exact-boots', 'boots', { power: 10 }),
    item('exact-weapon', 'weapon', { ap: 1, power: 10 }), item('exact-shield', 'shield', { ap: 1, power: 10 }),
    item('exact-companion', 'companion', { power: 10 }),
    ...fixedDofus()
  ];
  return { items, sets };
}

function buildKey(result) {
  return (result?.items || []).map((entry) => String(entry.id)).sort().join('|');
}

function runExact({ multi = false, coreFirstEnabled = true, contextualDofusGuidance = true } = {}) {
  const { items, sets } = exactFixture();
  return searchConstraintCompletenessRescue({
    items, sets, selections: selections(multi), constraints: { ap: 12 },
    fmPolicy: { spellDamagePct: 0, allowCritDamage: false, critDamageAmount: 8, exoAp: 0, exoMp: 0 },
    turnMode: 't1', scenario: { requiredApByTurn: {} }, searchProfile: 'BALANCED',
    coreFirstEnabled, contextualDofusGuidance, useOffensiveBound: false
  });
}

for (const [label, multi] of [['Fire', false], ['Multi', true]]) {
  test(`core-first ${label} keeps the exact winner and score identical`, () => {
    const before = runExact({ multi, coreFirstEnabled: false, contextualDofusGuidance: false });
    const after = runExact({ multi, coreFirstEnabled: true, contextualDofusGuidance: true });
    assert.equal(before.results.length, 1);
    assert.equal(after.results.length, 1);
    assert.equal(buildKey(after.results[0]), buildKey(before.results[0]));
    assert.ok(Math.abs(Number(after.results[0].score || 0) - Number(before.results[0].score || 0)) <= EPSILON);
  });
}

test('standalone lane preserves an exact winner that uses no prioritized set core', () => {
  const { items, sets } = exactFixture();
  const weakSets = [{ ...sets[0], bonuses: { 2: { power: 1 } } }];
  const before = searchConstraintCompletenessRescue({
    items, sets: weakSets, selections: selections(false), constraints: { ap: 12 },
    fmPolicy: { spellDamagePct: 0, allowCritDamage: false, critDamageAmount: 8, exoAp: 0, exoMp: 0 },
    turnMode: 't1', scenario: { requiredApByTurn: {} }, searchProfile: 'BALANCED', coreFirstEnabled: false
  });
  const after = searchConstraintCompletenessRescue({
    items, sets: weakSets, selections: selections(false), constraints: { ap: 12 },
    fmPolicy: { spellDamagePct: 0, allowCritDamage: false, critDamageAmount: 8, exoAp: 0, exoMp: 0 },
    turnMode: 't1', scenario: { requiredApByTurn: {} }, searchProfile: 'BALANCED', coreFirstEnabled: true
  });
  assert.equal(buildKey(after.results[0]), buildKey(before.results[0]));
  assert.match(buildKey(after.results[0]), /standalone-hat/);
  assert.match(buildKey(after.results[0]), /standalone-cape/);
  assert.equal(after.diagnostics.constraintRescueSetCoreStandaloneBranches, 1);
});

test('synthetic set-heavy search reaches its first incumbent in fewer structural nodes', () => {
  const before = runExact({ coreFirstEnabled: false, contextualDofusGuidance: false });
  const after = runExact({ coreFirstEnabled: true, contextualDofusGuidance: true });
  assert.equal(buildKey(after.results[0]), buildKey(before.results[0]));
  assert.ok(Math.abs(Number(after.results[0].score || 0) - Number(before.results[0].score || 0)) <= EPSILON);
  assert.ok(Number(after.diagnostics.constraintRescueNodesAtFirstIncumbent)
    < Number(before.diagnostics.constraintRescueNodesAtFirstIncumbent));
  assert.ok(Number(after.diagnostics.constraintRescueSetCoreSeeds || 0) > 0);
  assert.equal(after.diagnostics.constraintRescueSetCoreStandaloneBranches, 1);
});
