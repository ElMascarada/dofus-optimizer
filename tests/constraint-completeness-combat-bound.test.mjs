import test from 'node:test';
import assert from 'node:assert/strict';
import { searchConstraintCompletenessRescue } from '../js/constraint-completeness-rescue.js';
import { refineCombatTurns } from '../js/combat-turn-refiner.js';
import {
  COMBAT_T1_BOUND_STAT_KEYS,
  combatT1UpperBound,
  createCombatT1UpperBoundContext
} from '../js/combat-t1-upper-bound.js';
import { createCandidatePolicy } from '../optimizer/candidate-policy.js';

const EPSILON = 1e-9;

function item(id, slot, stats = {}, extra = {}) {
  return { id, name: id, level: 200, slot, setId: null, stats, passives: [], conditions: null,
    slotSubtype: null, typeName: slot, ...extra };
}
function defaultDofus() {
  return Array.from({ length: 6 }, (_, index) => item(`dofus-${index + 1}`, 'dofus', { fire: 5 }, { typeName: 'Dofus' }));
}
function fixedShape({ hats, belts, companions, dofuses } = {}) {
  return [
    ...(hats || [item('hat', 'hat', { ap: 1, fire: 10 })]),
    item('cape', 'cape', { ap: 1, fire: 10 }),
    item('amulet', 'amulet', { ap: 1, fire: 10 }),
    item('ring-a', 'ring', { fire: 10 }), item('ring-b', 'ring', { fire: 10 }),
    ...(belts || [item('belt', 'belt', { fire: 10 })]),
    item('boots', 'boots', { fire: 10 }),
    item('weapon', 'weapon', { ap: 1, fire: 10 }), item('shield', 'shield', { ap: 1, fire: 10 }),
    ...(companions || [item('companion', 'companion', { fire: 10 })]),
    ...(dofuses || defaultDofus())
  ];
}
function damageSelections(spells = []) {
  return spells.filter((spell) => Array.isArray(spell?.hits) && spell.hits.length > 0).map((spell) => ({
    enabled: true, weight: 1, spell, casts: { 1: 1, 2: 0, 3: 0 }
  }));
}
function buildKey(build) {
  return (build?.items || []).map((entry) => String(entry.id)).sort().join('|');
}
function combatOptions(items, classSpells, { bounded = true, sets = [], metric = 'total-damage', requiredItemIds = [] } = {}) {
  const combatObjective = { turnMode: 't1', element: 'fire', targetMode: 'single', allowSupport: true, metric };
  const scenario = { requiredApByTurn: {} };
  return {
    items, sets, selections: damageSelections(classSpells), constraints: { ap: 12 },
    fmPolicy: { spellDamagePct: 0, allowCritDamage: false, critDamageAmount: 8, exoAp: 0, exoMp: 0 },
    turnMode: 't1', scenario, searchProfile: 'BALANCED', useOffensiveBound: false, requiredItemIds,
    ...(bounded ? { objectiveMode: 'combat', classSpells, combatObjective } : {}),
    scoreValidBuild(build) {
      return refineCombatTurns({
        results: [build], spells: classSpells, combatObjective, scenario, topN: 1,
        preservePrysmaradites: false, searchProfile: 'BALANCED'
      }).results?.[0] || null;
    }
  };
}

const plainFireSpell = {
  id: 'bound-fire', name: 'Bound fire', apCost: 3, baseCritPct: 0,
  hits: [{ element: 'fire', normal: [30, 30], crit: [30, 30] }]
};

test('Combat T1 branch-and-bound prunes score-dominated branches after an early incumbent without changing the exact winner', () => {
  const hats = [
    item('early-best', 'hat', { ap: 1, fire: 10000 }),
    ...Array.from({ length: 9 }, (_, index) => item(`early-low-${index}`, 'hat', { ap: 1, fire: index * 5 }))
  ];
  const items = fixedShape({ hats });
  const exhaustive = searchConstraintCompletenessRescue(combatOptions(items, [plainFireSpell], { bounded: false }));
  const bounded = searchConstraintCompletenessRescue(combatOptions(items, [plainFireSpell], { bounded: true }));

  assert.equal(bounded.results.length, 1);
  assert.equal(exhaustive.results.length, 1);
  assert.equal(buildKey(bounded.results[0]), buildKey(exhaustive.results[0]));
  assert.ok(Math.abs(bounded.results[0].score - exhaustive.results[0].score) <= EPSILON);
  assert.match(buildKey(bounded.results[0]), /early-best/);
  assert.ok(Number(bounded.diagnostics.constraintRescueCombatBoundCalls || 0) > 0);
  assert.ok(Number(bounded.diagnostics.constraintRescueCombatBoundPruned || 0) > 0);
  assert.ok(Number(bounded.diagnostics.constraintRescuePruneReasons?.['combat-t1-upper-bound'] || 0) > 0);
  assert.ok(bounded.diagnostics.constraintRescueNodes < exhaustive.diagnostics.constraintRescueNodes);
  assert.equal(bounded.diagnostics.constraintRescueFirstIncumbentScore,
    bounded.diagnostics.constraintRescueFinalIncumbentScore);
});

const lateStrike = {
  id: 'late-strike', name: 'Late strike', apCost: 2, baseCritPct: 0,
  hits: [{ element: 'fire', normal: [20, 20], crit: [20, 20] }]
};
const lateCharge = {
  id: 'late-charge', name: 'Late charge', apCost: 2, baseCritPct: 0, hits: [], combatRelevant: true,
  selfCharge: { id: 'late-charge-effect', targetSpellId: 'late-strike', durationTurns: 1,
    baseDamageBonus: 0, critBaseDamageBonus: 300, maxStacks: 1 }
};

test('Combat T1 upper bound keeps a late branch whose support interaction can still beat the incumbent', () => {
  const items = fixedShape({ hats: [
    item('early-static', 'hat', { ap: 1, fire: 1200 }),
    item('late-charge-crit', 'hat', { ap: 1, crit: 100 }),
    item('late-low', 'hat', { ap: 1 })
  ] });
  const spells = [lateStrike, lateCharge];
  const exhaustive = searchConstraintCompletenessRescue(combatOptions(items, spells, { bounded: false }));
  const bounded = searchConstraintCompletenessRescue(combatOptions(items, spells, { bounded: true }));

  assert.equal(bounded.results.length, 1);
  assert.equal(exhaustive.results.length, 1);
  assert.equal(buildKey(bounded.results[0]), buildKey(exhaustive.results[0]));
  assert.ok(Math.abs(bounded.results[0].score - exhaustive.results[0].score) <= EPSILON);
  assert.match(buildKey(bounded.results[0]), /late-charge-crit/);
  assert.ok(Number(bounded.diagnostics.constraintRescueCombatBoundCalls || 0) > 0);
  assert.ok(Number(bounded.diagnostics.constraintRescueFinalIncumbentScore || 0)
    > Number(bounded.diagnostics.constraintRescueFirstIncumbentScore || 0));
});

function looseRemainingCaps(items, selectedIds) {
  const caps = Object.fromEntries(COMBAT_T1_BOUND_STAT_KEYS.map((key) => [key, 0]));
  for (const entry of items) {
    if (selectedIds.has(String(entry.id))) continue;
    for (const key of COMBAT_T1_BOUND_STAT_KEYS) caps[key] += Math.max(0, Number(entry.stats?.[key] || 0));
  }
  return { caps, bounded: true, impossibleShape: false };
}

test('Combat T1 bound dominates the true exhaustive descendant maximum at several partial depths', () => {
  const set = { id: 'bound-set', name: 'Bound set', bonuses: { 2: { fire: 75, critDamage: 20 } } };
  const items = fixedShape({
    hats: [
      item('set-hat', 'hat', { ap: 1, fire: 80 }, { setId: set.id }),
      item('plain-hat', 'hat', { ap: 1, fire: 45 })
    ],
    belts: [item('set-belt', 'belt', { fire: 50 }, { setId: set.id }), item('plain-belt', 'belt', { fire: 20 })],
    companions: [item('crit-pet', 'companion', { crit: 50 }), item('fire-pet', 'companion', { fire: 60 })],
    dofuses: [
      item('dofus-crit', 'dofus', { crit: 20 }, { typeName: 'Dofus' }),
      item('dofus-fire', 'dofus', { fire: 80 }, { typeName: 'Dofus' }),
      ...Array.from({ length: 5 }, (_, index) => item(`dofus-adm-${index}`, 'dofus', { fire: 5 + index }, { typeName: 'Dofus' }))
    ]
  });
  const spell = { id: 'adm-fire', name: 'Adm fire', apCost: 3, baseCritPct: 10,
    hits: [{ element: 'fire', normal: [28, 32], crit: [42, 48] }] };
  const options = combatOptions(items, [spell], { bounded: false, sets: [set] });
  const policy = createCandidatePolicy({ ...options, slotRules: undefined });
  const context = createCombatT1UpperBoundContext({
    classSpells: [spell], combatObjective: { turnMode: 't1', element: 'fire', targetMode: 'single', metric: 'total-damage' },
    scenario: options.scenario, searchProfile: 'BALANCED', sets: [set], fmPolicy: options.fmPolicy
  });
  const states = [
    [],
    ['set-hat'],
    ['set-hat', 'set-belt'],
    ['set-hat', 'set-belt', 'crit-pet'],
    ['set-hat', 'set-belt', 'crit-pet', 'dofus-crit']
  ];

  for (const requiredItemIds of states) {
    const descendant = searchConstraintCompletenessRescue({ ...options, requiredItemIds }).results[0];
    assert.ok(descendant, `expected reachable descendant for ${requiredItemIds.join('|') || 'root'}`);
    const selected = items.filter((entry) => requiredItemIds.includes(String(entry.id)));
    const upper = combatT1UpperBound({
      items: selected,
      remainingCaps: looseRemainingCaps(items, new Set(requiredItemIds)),
      policy,
      context
    });
    assert.ok(Number.isFinite(upper));
    assert.ok(upper + EPSILON >= Number(descendant.score || 0),
      `${requiredItemIds.join('|') || 'root'}: upper=${upper}, descendant=${descendant.score}`);
  }
});

test('opaque mechanic hooks force Infinity and therefore cannot cause Combat/T1 bound pruning', () => {
  const opaqueSpell = {
    id: 'opaque-hupper', name: 'Opaque hupper', breedId: 17, apCost: 3, baseCritPct: 0,
    hits: [{ element: 'fire', normal: [30, 30], crit: [40, 40] }]
  };
  const items = fixedShape({ hats: [item('opaque-a', 'hat', { ap: 1, fire: 1000 }), item('opaque-b', 'hat', { ap: 1 })] });
  const options = combatOptions(items, [opaqueSpell], { bounded: true });
  const context = createCombatT1UpperBoundContext({
    classSpells: [opaqueSpell], combatObjective: options.combatObjective, scenario: options.scenario,
    searchProfile: 'BALANCED', sets: [], fmPolicy: options.fmPolicy
  });
  const policy = createCandidatePolicy({ ...options, slotRules: undefined });
  const direct = combatT1UpperBound({
    items: [], remainingCaps: looseRemainingCaps(items, new Set()), policy, context
  });
  assert.equal(direct, Infinity);

  const result = searchConstraintCompletenessRescue(options);
  assert.ok(result.results.length === 1);
  assert.ok(Number(result.diagnostics.constraintRescueCombatBoundCalls || 0) > 0);
  assert.equal(Number(result.diagnostics.constraintRescueCombatBoundPruned || 0), 0);
});

test('representative Multi/T1 bound sample remains finite for 100 non-opaque states', () => {
  const spells = [
    { id: 'multi-fire', name: 'Multi fire', apCost: 3, baseCritPct: 10,
      hits: [{ element: 'fire', normal: [25, 30], crit: [38, 44] }] },
    { id: 'multi-water', name: 'Multi water', apCost: 3, baseCritPct: 5,
      hits: [{ element: 'water', normal: [24, 31], crit: [36, 46] }] },
    { id: 'multi-support', name: 'Multi support', apCost: 2, hits: [], combatRelevant: true,
      combatModifiers: [{ id: 'multi-power', scope: 'self', stats: { power: 80 }, durationTurns: 1 }] }
  ];
  const items = fixedShape({ hats: [item('sample-hat', 'hat', { ap: 1, power: 50 })] });
  const base = combatOptions(items, spells, { bounded: true });
  const combatObjective = { ...base.combatObjective, element: 'multi' };
  const policy = createCandidatePolicy({ ...base, slotRules: undefined });
  const context = createCombatT1UpperBoundContext({
    classSpells: spells, combatObjective, scenario: base.scenario, searchProfile: 'BALANCED', sets: [], fmPolicy: base.fmPolicy
  });
  let finite = 0;
  let infinite = 0;
  for (let index = 0; index < 100; index++) {
    const selected = index % 2 ? [items[0]] : [];
    const upper = combatT1UpperBound({
      items: selected,
      remainingCaps: looseRemainingCaps(items, new Set(selected.map((entry) => String(entry.id)))),
      policy,
      context
    });
    if (Number.isFinite(upper)) finite++;
    else infinite++;
  }
  assert.equal(finite, 100);
  assert.equal(infinite, 0);
});

test('total-damage Combat/T1 bound is also safe for damage-per-AP scoring', () => {
  const items = fixedShape({ hats: [
    item('dpa-high', 'hat', { ap: 1, fire: 500 }),
    item('dpa-crit', 'hat', { ap: 1, crit: 70, critDamage: 30 }),
    item('dpa-low', 'hat', { ap: 1, fire: 10 })
  ] });
  const spell = { id: 'dpa-fire', name: 'DPA fire', apCost: 3, baseCritPct: 10,
    hits: [{ element: 'fire', normal: [28, 30], crit: [45, 50] }] };
  const exhaustive = searchConstraintCompletenessRescue(combatOptions(items, [spell], { bounded: false, metric: 'damage-per-ap' }));
  const bounded = searchConstraintCompletenessRescue(combatOptions(items, [spell], { bounded: true, metric: 'damage-per-ap' }));
  assert.equal(buildKey(bounded.results[0]), buildKey(exhaustive.results[0]));
  assert.ok(Math.abs(bounded.results[0].score - exhaustive.results[0].score) <= EPSILON);
});
