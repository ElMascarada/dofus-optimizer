import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalEquipmentFootprint,
  combatT1ParetoDimensions,
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
const waterSpell = {
  id: 'pareto-water', name: 'Pareto water', apCost: 3, baseCritPct: 10,
  hits: [{ element: 'water', normal: [27, 31], crit: [41, 46] }],
  distanceOptions: ['ranged']
};
const earthSpell = {
  id: 'pareto-earth', name: 'Pareto earth', apCost: 3, baseCritPct: 5,
  hits: [{ element: 'earth', normal: [26, 32], crit: [40, 48] }],
  distanceOptions: ['ranged']
};
const selections = [{ enabled: true, weight: 1, spell: fireSpell, casts: { 1: 1, 2: 0, 3: 0 } }];

function spellSelections(spells = []) {
  return spells.map((spell) => ({ enabled: true, weight: 1, spell, casts: { 1: 1, 2: 0, 3: 0 } }));
}

function reducer(constraints = {}, extra = {}) {
  return createEquipmentParetoReducer({
    setsById: {}, selections, constraints, scenario: {}, combatObjective: { turnMode: 't1', element: 'fire' },
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

test('mono Fire ignores off-element offense that has no constraint or legality role', () => {
  const offense = item('a-fire', 'hat', { ap: 1, fire: 120, power: 40 });
  const offElement = item('b-off-element', 'hat', { ap: 1, fire: 20, water: 150, earth: 100 });
  const pareto = reducer();
  pareto.consider([offense]);
  pareto.consider([offElement]);
  assert.deepEqual(ids(pareto.entries()), ['a-fire']);
  const profile = pareto.entries()[0].profile;
  assert.ok(profile.dimensions.includes('fire'));
  assert.equal(profile.dimensions.includes('water'), false);
  assert.equal(profile.dimensions.includes('earth'), false);
});

test('mono Fire off-elements re-enter only through an active Initiative floor', () => {
  const offense = item('a-fire', 'hat', { ap: 1, fire: 120, power: 40 });
  const initiative = item('b-initiative', 'hat', { ap: 1, fire: 20, water: 250, earth: 250 });

  const withoutFloor = reducer();
  withoutFloor.consider([offense]);
  withoutFloor.consider([initiative]);
  assert.deepEqual(ids(withoutFloor.entries()), ['a-fire']);

  const withFloor = reducer({ initiative: 4000 });
  withFloor.consider([offense]);
  withFloor.consider([initiative]);
  assert.equal(withFloor.entries().length, 2);
  assert.equal(withFloor.entries()[0].profile.dimensions.includes('water'), false);
  assert.ok(withFloor.entries()[0].profile.dimensions.includes('initiative'));
});

test('Multi keeps real multi-element value from enabled damage spells', () => {
  const multiSelections = spellSelections([fireSpell, waterSpell, earthSpell]);
  const pareto = reducer({}, {
    selections: multiSelections,
    combatObjective: { turnMode: 't1', element: 'multi' }
  });
  pareto.consider([item('a-fire', 'hat', { ap: 1, fire: 150, power: 20 })]);
  pareto.consider([item('b-water-earth', 'hat', { ap: 1, fire: 20, water: 140, earth: 140 })]);
  assert.equal(pareto.entries().length, 2);
  const dimensions = combatT1ParetoDimensions(multiSelections, {}, { turnMode: 't1', element: 'multi' }).dimensions;
  assert.ok(dimensions.has('fire'));
  assert.ok(dimensions.has('water'));
  assert.ok(dimensions.has('earth'));
});

test('Multi critDamage versus flat/power context stays on the real primitive frontier without a hardcoded winner', () => {
  const multiLineFire = {
    id: 'multi-line-fire', name: 'Multi-line fire', apCost: 4, baseCritPct: 20,
    hits: [
      { element: 'fire', normal: [15, 15], crit: [22, 22] },
      { element: 'fire', normal: [15, 15], crit: [22, 22] }
    ]
  };
  const multiSelections = spellSelections([multiLineFire, waterSpell]);
  const pareto = reducer({}, {
    selections: multiSelections,
    combatObjective: { turnMode: 't1', element: 'multi' }
  });
  pareto.consider([item('a-flat-power', 'hat', { ap: 1, power: 55, damage: 20, crit: 10 })]);
  pareto.consider([item('b-crit-damage', 'hat', { ap: 1, power: 20, critDamage: 90, crit: 10 })]);
  assert.equal(pareto.entries().length, 2);
});

test('permanent AP cap safety makes different AP states legally incompatible for destructive dominance', () => {
  const base = { setsById: {}, selections, constraints: {}, scenario: {}, combatObjective: { turnMode: 't1', element: 'fire' }, fmPolicy: {} };
  const moreAp = createEquipmentParetoProfile({
    ...base, items: [item('a-more-ap', 'hat', { ap: 2, power: 40 })]
  });
  const lessAp = createEquipmentParetoProfile({
    ...base, items: [item('b-less-ap', 'hat', { ap: 1, power: 10 })]
  });
  assert.notEqual(moreAp.compatibilityKey, lessAp.compatibilityKey);
  assert.equal(equipmentProfileDominates(moreAp, lessAp), false);
});

test('partial equipment/core continuation is never Pareto-pruned before the final equipment subset is resolved', () => {
  const partial = createEquipmentParetoProfile({
    items: [item('partial-2-piece', 'hat', { power: 1 })],
    setsById: {}, selections, constraints: {}, scenario: {}, combatObjective: { turnMode: 't1', element: 'fire' }, fmPolicy: {}, structureResolved: false
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

test('NO CRIT scenario heuristic cannot remove Crit/CritDamage from destructive safety', () => {
  const pareto = reducer({}, { scenario: { noCrit: true } });
  pareto.consider([item('a-power', 'hat', { ap: 1, power: 40, crit: 10 })]);
  pareto.consider([item('b-crit-damage', 'hat', { ap: 1, power: 10, crit: 10, critDamage: 100 })]);
  assert.equal(pareto.entries().length, 2);
  const profile = pareto.entries()[0].profile;
  assert.ok(profile.dimensions.includes('critDamage'));
  assert.equal(profile.noCritDestructiveHeuristic, false);
});

test('Crit is equality-required for destructive dominance even when critical base damage is higher', () => {
  const base = { setsById: {}, selections, constraints: {}, scenario: {}, combatObjective: { turnMode: 't1', element: 'fire' }, fmPolicy: {} };
  const moreCritNegativeDamage = createEquipmentParetoProfile({
    ...base,
    items: [item('a-more-crit-negative-damage', 'hat', { ap: 1, power: 40, crit: 60, critDamage: -200 })]
  });
  const lessCrit = createEquipmentParetoProfile({
    ...base,
    items: [item('b-less-crit', 'hat', { ap: 1, power: 10, crit: 10, critDamage: 0 })]
  });
  assert.equal(moreCritNegativeDamage.critMonotone, false);
  assert.notEqual(moreCritNegativeDamage.compatibilityKey, lessCrit.compatibilityKey);
  assert.equal(equipmentProfileDominates(moreCritNegativeDamage, lessCrit), false);
});

test('required common passive or turn bonus disables destructive Pareto as opaque', () => {
  const required = item('required-dynamic', 'companion', {}, {
    passives: [{ id: 'required-passive', rules: [{ trigger: { type: 'always' }, stats: { power: 10 } }] }],
    turnBonuses: { 1: { fire: 30 } }
  });
  const pareto = reducer({}, { requiredItemIds: [required.id] });
  pareto.consider([required, item('a-strong', 'hat', { ap: 1, power: 40 })]);
  pareto.consider([required, item('b-weak', 'hat', { ap: 1, power: 10 })]);
  assert.equal(pareto.entries().length, 2);
  assert.equal(pareto.diagnostics().constraintRescueParetoDominated, 0);
  assert.equal(pareto.diagnostics().constraintRescueParetoOpaqueKept, 2);
  assert.ok(pareto.entries().every((entry) => entry.profile.opaqueReason === 'opaque-common-dynamic-effect'));
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

function combatOptions(items, spells, { equipmentParetoEnabled = true, element = 'fire' } = {}) {
  const combatObjective = { turnMode: 't1', element, targetMode: 'single', allowSupport: true, metric: 'total-damage' };
  const scenario = { requiredApByTurn: {} };
  return {
    items, sets: [], selections: spellSelections(spells),
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

function exhaustiveCombatOptions(items, spells, extra = {}) {
  const options = combatOptions(items, spells, { ...extra, equipmentParetoEnabled: false });
  delete options.objectiveMode;
  return options;
}

function buildKey(build) {
  return (build?.items || []).map((entry) => String(entry.id)).sort().join('|');
}

function assertExactIdentity(before, after) {
  assert.equal(before.results.length, 1);
  assert.equal(after.results.length, 1);
  assert.equal(buildKey(after.results[0]), buildKey(before.results[0]));
  assert.ok(Math.abs(Number(after.results[0].score || 0) - Number(before.results[0].score || 0)) <= EPSILON);
}

test('small exact Fire enumeration returns the identical winner and score with slot-footprint Pareto enabled', () => {
  const items = fixedShape({ hats: [
    item('a-best-hat', 'hat', { ap: 1, fire: 150, power: 30 }),
    item('b-late-hat', 'hat', { ap: 1, fire: 40, power: 5, water: 300, earth: 300 })
  ] });
  const before = exhaustiveCombatOptions(items, [fireSpell], { element: 'fire' });
  const baseline = searchCombatT1ConstraintRescue(before);
  const after = searchCombatT1ConstraintRescue(combatOptions(items, [fireSpell], { equipmentParetoEnabled: true, element: 'fire' }));
  assertExactIdentity(baseline, after);
  assert.ok(Number(after.diagnostics.constraintRescueParetoDominated || 0) > 0);
});

test('small exact Multi enumeration returns the identical winner and score with contextual dimensions', () => {
  const items = fixedShape({ hats: [
    item('a-fire-hat', 'hat', { ap: 1, fire: 150, power: 20 }),
    item('b-water-hat', 'hat', { ap: 1, water: 160, power: 15 })
  ] });
  const spells = [fireSpell, waterSpell];
  const before = searchCombatT1ConstraintRescue(exhaustiveCombatOptions(items, spells, { element: 'multi' }));
  const after = searchCombatT1ConstraintRescue(combatOptions(items, spells, { equipmentParetoEnabled: true, element: 'multi' }));
  assertExactIdentity(before, after);
});

test('streaming Pareto gets a real incumbent before equipment enumeration ends and skips dominated structures before Companion/Dofus', () => {
  const hats = [
    item('a00-best', 'hat', { ap: 1, fire: 120, power: 30 }),
    item('b01-dominated', 'hat', { ap: 1, fire: 119, power: 30 }),
    item('b02-dominated', 'hat', { ap: 1, fire: 118, power: 30 }),
    item('b03-dominated', 'hat', { ap: 1, fire: 117, power: 30 })
  ];
  const single = searchCombatT1ConstraintRescue(combatOptions(fixedShape({ hats: [hats[0]] }), [fireSpell]));
  const streaming = searchCombatT1ConstraintRescue(combatOptions(fixedShape({ hats }), [fireSpell]));
  const exact = searchCombatT1ConstraintRescue(exhaustiveCombatOptions(fixedShape({ hats }), [fireSpell]));

  assertExactIdentity(exact, streaming);
  const diagnostics = streaming.diagnostics;
  assert.ok(Number(diagnostics.constraintRescueEquipmentStructuresAtFirstIncumbent || 0)
    < Number(diagnostics.constraintRescueEquipmentStructures || 0));
  assert.ok(Number(diagnostics.constraintRescueParetoDominated || 0) > 0);
  assert.equal(Number(diagnostics.constraintRescueCompanionExpansions || 0),
    Number(single.diagnostics.constraintRescueCompanionExpansions || 0));
  assert.equal(Number(diagnostics.constraintRescueDofusExpansions || 0),
    Number(single.diagnostics.constraintRescueDofusExpansions || 0));
});

test('streaming Pareto and Combat/T1 B&B both prune in the same run without changing the exact winner', () => {
  const hats = [
    item('a00-best', 'hat', { ap: 1, fire: 10000 }),
    item('b01-dominated', 'hat', { ap: 1, fire: 100 }),
    item('c02-bnb-survivor', 'hat', { ap: 1, critDamage: 1 })
  ];
  const items = fixedShape({ hats });
  const exhaustive = searchCombatT1ConstraintRescue(exhaustiveCombatOptions(items, [fireSpell]));
  const streaming = searchCombatT1ConstraintRescue(combatOptions(items, [fireSpell]));

  assertExactIdentity(exhaustive, streaming);
  assert.ok(Number(streaming.diagnostics.constraintRescueParetoDominated || 0) > 0);
  assert.ok(Number(streaming.diagnostics.constraintRescueCombatBoundCalls || 0) > 0);
  assert.ok(Number(streaming.diagnostics.constraintRescueCombatBoundPruned || 0) > 0);
  assert.ok(Number(streaming.diagnostics.constraintRescueEquipmentStructuresAtFirstIncumbent || 0)
    < Number(streaming.diagnostics.constraintRescueEquipmentStructures || 0));
});

test('opaque Combat mechanics disable destructive Equipment Pareto while preserving the exact winner', () => {
  const opaqueSpell = {
    ...fireSpell,
    id: 'pareto-opaque-combat',
    breedId: 17
  };
  const items = fixedShape({ hats: [
    item('opaque-a', 'hat', { ap: 1, fire: 500 }),
    item('opaque-b', 'hat', { ap: 1, fire: 10 })
  ] });
  const exhaustive = searchCombatT1ConstraintRescue(exhaustiveCombatOptions(items, [opaqueSpell]));
  const opaque = searchCombatT1ConstraintRescue(combatOptions(items, [opaqueSpell]));

  assertExactIdentity(exhaustive, opaque);
  assert.equal(Number(opaque.diagnostics.constraintRescueParetoDominated || 0), 0);
  assert.equal(Number(opaque.diagnostics.constraintRescueParetoFrontier || 0), 0);
});

test('synthetic dominated equipment fixture reduces Dofus expansion while preserving the exact winner', () => {
  const hats = Array.from({ length: 12 }, (_, index) => item(
    index === 0 ? 'a00-best' : `b${String(index).padStart(2, '0')}-dominated`,
    'hat',
    { ap: 1, fire: 200 - index, power: 40 }
  ));
  const dofuses = Array.from({ length: 9 }, (_, index) => item(`dofus-${index}`, 'dofus', { fire: 5 + index }));
  const items = fixedShape({ hats, dofuses });
  const before = searchCombatT1ConstraintRescue(exhaustiveCombatOptions(items, [fireSpell], { element: 'fire' }));
  const after = searchCombatT1ConstraintRescue(combatOptions(items, [fireSpell], { equipmentParetoEnabled: true, element: 'fire' }));

  assertExactIdentity(before, after);
  assert.ok(Number(after.diagnostics.constraintRescueEquipmentStructuresAtFirstIncumbent || 0)
    < Number(after.diagnostics.constraintRescueEquipmentStructures || 0));
  assert.ok(Number(after.diagnostics.constraintRescueParetoDominated || 0) >= 10);
  assert.ok(Number(after.diagnostics.constraintRescueDofusExpansions || 0)
    < Number(before.diagnostics.constraintRescueDofusExpansions || 0));
  assert.equal(Number(after.diagnostics.constraintRescueEquipmentStructures || 0), 12);
  assert.equal(Number(after.diagnostics.constraintRescueParetoFrontier || 0), 1);
});
