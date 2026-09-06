import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalEquipmentFootprint,
  createEquipmentParetoProfile,
  createEquipmentParetoReducer,
  equipmentProfileDominates
} from '../js/equipment-slot-footprint-pareto.js';
import { searchCombatT1ConstraintRescue } from '../js/constraint-completeness-combat-t1.js';
import { refineCombatTurns } from '../js/combat-turn-refiner.js';

const EPSILON = 1e-9;

function item(id, slot, stats = {}, extra = {}) {
  return {
    id, name: id, level: 200, slot, setId: null, stats,
    passives: [], effects: [], conditions: null, turnBonuses: {}, pendingDynamicEffects: [],
    slotSubtype: null, typeName: slot, ...extra
  };
}

const fireSpell = {
  id: 'pareto-fire', name: 'Pareto fire', apCost: 3, baseCritPct: 10,
  hits: [{ element: 'fire', normal: [28, 30], crit: [42, 45] }],
  distanceOptions: ['ranged']
};
const selections = [{ enabled: true, weight: 1, spell: fireSpell, casts: { 1: 1, 2: 0, 3: 0 } }];

function reducer(constraints = {}, extra = {}) {
  return createEquipmentParetoReducer({
    setsById: {}, selections, constraints, scenario: {},
    fmPolicy: { spellDamagePct: 0, allowCritDamage: false, exoAp: 0, exoMp: 0 },
    ...extra
  });
}

function ids(entries = []) {
  return entries.map((entry) => entry.items.map((it) => String(it.id)).sort().join('|'));
}

test('same footprint: strictly stronger offense dominates before Companion/Dofus expansion', () => {
  const pareto = reducer();
  pareto.consider([item('a-strong', 'hat', { ap: 1, power: 40 })]);
  pareto.consider([item('b-weak', 'hat', { ap: 1, power: 10 })]);
  assert.deepEqual(ids(pareto.entries()), ['a-strong']);
  assert.equal(pareto.diagnostics().constraintRescueParetoDominated, 1);
});

test('different footprints are incomparable, including canonical double-ring footprints', () => {
  assert.equal(canonicalEquipmentFootprint([item('r1', 'ring'), item('r2', 'ring')]), 'ring|ring');
  const pareto = reducer();
  pareto.consider([item('a-hat', 'hat', { ap: 1, power: 40 })]);
  pareto.consider([item('b-cape', 'cape', { ap: 1, power: 10 })]);
  assert.equal(pareto.entries().length, 2);
  assert.equal(pareto.diagnostics().constraintRescueParetoDominated, 0);
});

test('defensive resistance only re-enters the Pareto frontier when its hard floor is active', () => {
  const offense = item('a-offense', 'hat', { ap: 1, power: 40 });
  const defense = item('b-defense', 'hat', { ap: 1, power: 10, resFire: 30 });

  const withoutFloor = reducer();
  withoutFloor.consider([offense]);
  withoutFloor.consider([defense]);
  assert.deepEqual(ids(withoutFloor.entries()), ['a-offense']);

  const withFloor = reducer({ resFire: 30 });
  withFloor.consider([offense]);
  withFloor.consider([defense]);
  assert.equal(withFloor.entries().length, 2);
  assert.equal(withFloor.diagnostics().constraintRescueParetoDominated, 0);
});

test('Initiative hard floor protects an Initiative structure without turning the floor into score', () => {
  const offense = item('a-offense', 'hat', { ap: 1, power: 40 });
  const initiative = item('b-initiative', 'hat', { ap: 1, power: 10, initiative: 400 });

  const withoutFloor = reducer();
  withoutFloor.consider([offense]);
  withoutFloor.consider([initiative]);
  assert.deepEqual(ids(withoutFloor.entries()), ['a-offense']);

  const withFloor = reducer({ initiative: 4000 });
  withFloor.consider([offense]);
  withFloor.consider([initiative]);
  assert.equal(withFloor.entries().length, 2);
});

test('permanent AP cap safety makes different AP states legally incompatible for destructive dominance', () => {
  const moreAp = createEquipmentParetoProfile({
    items: [item('a-more-ap', 'hat', { ap: 2, power: 40 })],
    setsById: {}, selections, constraints: {}, scenario: {}, fmPolicy: {}
  });
  const lessAp = createEquipmentParetoProfile({
    items: [item('b-less-ap', 'hat', { ap: 1, power: 10 })],
    setsById: {}, selections, constraints: {}, scenario: {}, fmPolicy: {}
  });
  assert.notEqual(moreAp.compatibilityKey, lessAp.compatibilityKey);
  assert.equal(equipmentProfileDominates(moreAp, lessAp), false);
});

test('partial equipment/core continuation is never Pareto-pruned before the final equipment subset is resolved', () => {
  const partial = createEquipmentParetoProfile({
    items: [item('partial-2-piece', 'hat', { power: 1 })],
    setsById: {}, selections, constraints: {}, scenario: {}, fmPolicy: {}, structureResolved: false
  });
  assert.equal(partial.opaque, true);
  assert.equal(partial.opaqueReason, 'partial-equipment-structure');
});

test('opaque dynamic effects keep the structure even when its static vector looks dominated', () => {
  const pareto = reducer();
  pareto.consider([item('a-static', 'hat', { ap: 1, power: 40 })]);
  pareto.consider([item('b-opaque', 'hat', { ap: 1, power: 10 }, {
    pendingDynamicEffects: [{ id: 'opaque-probe' }]
  })]);
  assert.equal(pareto.entries().length, 2);
  assert.equal(pareto.diagnostics().constraintRescueParetoOpaqueKept, 1);
});

test('NO CRIT context does not let Crit or Crit Damage save an otherwise dominated structure', () => {
  const pareto = reducer({}, { scenario: { noCrit: true } });
  pareto.consider([item('a-offense', 'hat', { ap: 1, power: 40 })]);
  pareto.consider([item('b-crit', 'hat', { ap: 1, power: 10, crit: 100, critDamage: 100 })]);
  assert.deepEqual(ids(pareto.entries()), ['a-offense']);
});

function fixedShape({ hats, dofuses } = {}) {
  return [
    ...(hats || [item('hat', 'hat', { ap: 1, fire: 10 })]),
    item('cape', 'cape', { ap: 1, fire: 10 }),
    item('amulet', 'amulet', { ap: 1, fire: 10 }),
    item('ring-a', 'ring', { fire: 10 }), item('ring-b', 'ring', { fire: 10 }),
    item('belt', 'belt', { fire: 10 }), item('boots', 'boots', { fire: 10 }),
    item('weapon', 'weapon', { ap: 1, fire: 10 }), item('shield', 'shield', { ap: 1, fire: 10 }),
    item('companion', 'companion', { fire: 10 }),
    ...(dofuses || Array.from({ length: 6 }, (_, index) => item(`dofus-${index}`, 'dofus', { fire: 5 })))
  ];
}

function combatOptions(items, spells, equipmentParetoEnabled = true) {
  const combatObjective = { turnMode: 't1', element: 'fire', targetMode: 'single', allowSupport: true, metric: 'total-damage' };
  const scenario = { requiredApByTurn: {} };
  return {
    items, sets: [], selections: spells.map((spell) => ({ enabled: true, weight: 1, spell, casts: { 1: 1, 2: 0, 3: 0 } })),
    constraints: { ap: 12 }, fmPolicy: { spellDamagePct: 0, allowCritDamage: false, critDamageAmount: 8, exoAp: 0, exoMp: 0 },
    turnMode: 't1', scenario, searchProfile: 'BALANCED', objectiveMode: 'combat', classSpells: spells, combatObjective,
    equipmentParetoEnabled,
    scoreValidBuild(build) {
      return refineCombatTurns({
        results: [build], spells, combatObjective, scenario, topN: 1,
        preservePrysmaradites: false, searchProfile: 'BALANCED'
      }).results?.[0] || null;
    }
  };
}

function buildKey(build) {
  return (build?.items || []).map((entry) => String(entry.id)).sort().join('|');
}

test('small exact enumeration returns the identical winner and score with slot-footprint Pareto enabled', () => {
  const items = fixedShape({ hats: [
    item('a-best-hat', 'hat', { ap: 1, fire: 150, power: 30 }),
    item('b-late-hat', 'hat', { ap: 1, fire: 40, power: 5 })
  ] });
  const before = searchCombatT1ConstraintRescue(combatOptions(items, [fireSpell], false));
  const after = searchCombatT1ConstraintRescue(combatOptions(items, [fireSpell], true));
  assert.equal(before.results.length, 1);
  assert.equal(after.results.length, 1);
  assert.equal(buildKey(after.results[0]), buildKey(before.results[0]));
  assert.ok(Math.abs(Number(after.results[0].score || 0) - Number(before.results[0].score || 0)) <= EPSILON);
  assert.ok(Number(after.diagnostics.constraintRescueParetoDominated || 0) > 0);
});

test('synthetic dominated equipment fixture massively reduces Dofus expansion while preserving the exact winner', () => {
  const opaqueBoundSpell = { ...fireSpell, id: 'pareto-opaque-bound', breedId: 17 };
  const hats = Array.from({ length: 12 }, (_, index) => item(
    index === 0 ? 'a00-best' : `b${String(index).padStart(2, '0')}-dominated`,
    'hat',
    { ap: 1, fire: 600 - index * 20, power: 120 - index * 3 }
  ));
  const dofuses = Array.from({ length: 9 }, (_, index) => item(`dofus-${index}`, 'dofus', { fire: 5 + index }));
  const items = fixedShape({ hats, dofuses });
  const before = searchCombatT1ConstraintRescue(combatOptions(items, [opaqueBoundSpell], false));
  const after = searchCombatT1ConstraintRescue(combatOptions(items, [opaqueBoundSpell], true));

  assert.equal(buildKey(after.results[0]), buildKey(before.results[0]));
  assert.ok(Math.abs(Number(after.results[0].score || 0) - Number(before.results[0].score || 0)) <= EPSILON);
  assert.ok(Number(after.diagnostics.constraintRescueParetoDominated || 0) >= 10);
  assert.ok(Number(after.diagnostics.constraintRescueDofusExpansions || 0)
    < Number(before.diagnostics.constraintRescueDofusExpansions || 0));
});
