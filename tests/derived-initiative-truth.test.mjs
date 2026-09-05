import test from 'node:test';
import assert from 'node:assert/strict';

import { BASE_CHARACTER } from '../js/config.js';
import {
  derivedInitiative,
  effectiveStat,
  meetsConstraints,
  constraintDeficits
} from '../js/stats.js';
import {
  maximumElementalCharacteristicGain,
  optimizeCharacteristics
} from '../js/characteristics.js';
import { evaluateCompleteBuild } from '../js/complete-build-evaluator.js';
import { prefilterItems } from '../js/candidate-prefilter.js';
import { pruneDominatedCandidates } from '../js/search-space.js';
import { searchArchitecturesV2 } from '../js/architecture-search-v2.js';
import { constraintProgressForStats } from '../optimizer/candidate-policy.js';
import { branchFeasibility } from '../optimizer/candidate-search.js';

const fireSpell = {
  id: 'derived-initiative-fire',
  name: 'Derived Initiative Fire',
  apCost: 3,
  baseCritPct: 0,
  hits: [{ element: 'fire', normal: [30, 30], crit: [30, 30] }]
};

const fireSelections = [{
  enabled: true,
  weight: 1,
  spell: fireSpell,
  casts: { 1: 1, 2: 0, 3: 0 }
}];

const fmPolicy = {
  spellDamagePct: 0,
  allowCritDamage: false,
  critDamageAmount: 8,
  exoAp: 0,
  exoMp: 0
};

function item(id, slot, stats = {}, typeName = slot) {
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
    typeName
  };
}

function legalFixture(extraStats = () => ({})) {
  const specs = [
    ['hat', 'hat', { ap: 1 }, 'Coiffe'],
    ['cape', 'cape', { ap: 1 }, 'Cape'],
    ['amulet', 'amulet', { ap: 1 }, 'Amulette'],
    ['ring-a', 'ring', {}, 'Anneau'],
    ['ring-b', 'ring', {}, 'Anneau'],
    ['belt', 'belt', {}, 'Ceinture'],
    ['boots', 'boots', { mp: 1 }, 'Bottes'],
    ['weapon', 'weapon', { ap: 1 }, 'Arme'],
    ['shield', 'shield', { ap: 1 }, 'Bouclier'],
    ['companion', 'companion', { mp: 2 }, 'Familier'],
    ...Array.from({ length: 6 }, (_, index) => [`dofus-${index + 1}`, 'dofus', {}, 'Dofus'])
  ];
  return specs.map(([id, slot, structural, typeName]) => item(
    id,
    slot,
    { ...structural, ...extraStats(id, slot) },
    typeName
  ));
}

test('derived Initiative sums four characteristics and signed direct Initiative before the zero floor', () => {
  assert.equal(derivedInitiative({
    earth: 230,
    fire: 790,
    water: 790,
    air: 790,
    initiative: 2600
  }), 5200);

  assert.equal(derivedInitiative({
    earth: 100,
    fire: 100,
    water: 100,
    air: 100,
    initiative: -150
  }), 250);

  assert.equal(derivedInitiative({ earth: 10, initiative: -50 }), 0);
});

test('Initiative constraints validate against the derived final value', () => {
  const stats = {
    earth: 230,
    fire: 790,
    water: 790,
    air: 790,
    initiative: 2600
  };

  for (const minimum of [4000, 5000, 5200]) {
    assert.equal(meetsConstraints(stats, { initiative: minimum }), true);
    assert.deepEqual(constraintDeficits(stats, { initiative: minimum }), {});
  }
  assert.equal(meetsConstraints(stats, { initiative: 5201 }), false);
  assert.deepEqual(constraintDeficits(stats, { initiative: 5201 }), { initiative: 1 });
  assert.equal(effectiveStat(stats, 'initiative'), 5200);
});

test('scrolls and characteristic allocation naturally raise final Initiative without being added twice', () => {
  const equipmentStats = { initiative: 3300 };
  assert.equal(meetsConstraints(equipmentStats, { initiative: 4000 }), false);

  const allocated = optimizeCharacteristics(equipmentStats, {
    points: BASE_CHARACTER.characteristicPoints,
    scrolled: BASE_CHARACTER.scrolled,
    elementValues: { earth: 0, fire: 10, water: 0, air: 0 },
    minimumVitality: 0,
    baseVitality: 0
  });

  assert.equal(meetsConstraints(allocated.stats, { initiative: 4000 }), true);
  assert.equal(effectiveStat(allocated.stats, 'initiative'), 4098);

  const fixture = legalFixture((id) => id === 'hat' ? { initiative: 3300 } : {});
  const evaluation = evaluateCompleteBuild({
    items: fixture,
    sets: [],
    selections: fireSelections,
    constraints: { ap: 12, mp: 6, initiative: 4000 },
    fmPolicy,
    turnMode: 't1',
    scenario: { requiredApByTurn: {} }
  });

  assert.ok(evaluation.result, 'final build validation must accept Initiative supplied by scrolls and allocated characteristics');
  assert.equal(evaluation.result.stats.initiative, 4098);
});

test('search progress recognizes direct Initiative and elemental characteristics as Initiative contributors', () => {
  const constraints = { initiative: 400 };
  const direct = constraintProgressForStats({ initiative: 200 }, constraints);
  const elemental = constraintProgressForStats({ earth: 100, fire: 100, water: 100, air: 100 }, constraints);

  assert.equal(direct.ready, false);
  assert.equal(direct.coverage, 0.5);
  assert.equal(elemental.ready, true);
  assert.equal(elemental.coverage, 1);
});

test('prefilter and Pareto treat four elemental characteristics as real Initiative contribution', () => {
  const direct = item('direct-init', 'hat', { initiative: 150 }, 'Coiffe');
  const elemental = item('elemental-init', 'hat', {
    earth: 100,
    fire: 100,
    water: 100,
    air: 100
  }, 'Coiffe');

  const pareto = pruneDominatedCandidates([direct, elemental], {
    keys: ['initiative'],
    groupCount: 1
  });
  assert.deepEqual(pareto.candidates.map((entry) => entry.id), ['elemental-init']);

  const prefiltered = prefilterItems({
    items: [direct, elemental],
    selections: [],
    constraints: { initiative: 300 },
    slotRules: [{ id: 'hat', count: 1 }]
  });
  const reasons = prefiltered.diagnostics.slots[0].reasons['elemental-init'] || [];
  assert.ok(prefiltered.items.some((entry) => entry.id === 'elemental-init'));
  assert.ok(reasons.includes('constraint:initiative'));
});

test('Initiative branch feasibility includes scrolls, real soft-cap allocation and remaining elemental items', () => {
  assert.equal(maximumElementalCharacteristicGain(BASE_CHARACTER.characteristicPoints), 697);

  const remainingGroups = [{ id: 'hat', missing: 1 }];
  const profiles = [{ optimisticStats: { earth: 400 }, bounded: true }];
  const profilesFor = () => profiles;
  const currentStats = { initiative: 3200 };

  const possible = branchFeasibility({
    currentStats,
    remainingGroups,
    profilesFor,
    constraints: { initiative: 4697 },
    sets: []
  });
  assert.equal(possible.feasible, true, 'a branch that can reach the Initiative minimum must not be pruned');

  const impossible = branchFeasibility({
    currentStats,
    remainingGroups,
    profilesFor,
    constraints: { initiative: 4698 },
    sets: []
  });
  assert.equal(impossible.feasible, false);
  assert.equal(impossible.key, 'initiative');
  assert.equal(impossible.maximum, 4697);
});

test('targeted search returns a legal 12 AP / 6 MP build with derived Initiative above 5000', () => {
  const items = legalFixture(() => ({ fire: 265 }));
  const output = searchArchitecturesV2({
    items,
    sets: [],
    selections: fireSelections,
    constraints: { ap: 12, mp: 6, initiative: 5000 },
    fmPolicy,
    turnMode: 't1',
    scenario: { requiredApByTurn: {} },
    topN: 1
  });

  assert.ok(output.results.length > 0, 'the small deterministic search must return the feasible derived-Initiative build');
  const best = output.results[0];
  assert.equal(best.stats.ap, 12);
  assert.equal(best.stats.mp, 6);
  assert.ok(best.stats.initiative >= 5000);
  assert.equal(best.items.length, 16);
});
