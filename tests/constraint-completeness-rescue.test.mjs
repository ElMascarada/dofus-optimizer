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
const critSpell = {
  id: 'rescue-crit-fire',
  name: 'Rescue crit fire',
  apCost: 3,
  baseCritPct: 0,
  hits: [{ element: 'fire', normal: [30, 30], crit: [70, 70] }]
};

function selectionsFor(spell = fireSpell) {
  return [{ enabled: true, weight: 1, spell, casts: { 1: 1, 2: 0, 3: 0 } }];
}

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
function defaultDofus() {
  return Array.from({ length: 6 }, (_, index) => item(`dofus-${index + 1}`, 'dofus', { fire: 5 }, { typeName: 'Dofus' }));
}
function fixedShape({
  hats,
  capes,
  amulets,
  rings,
  belts,
  boots,
  weapons,
  shields,
  companions,
  dofuses
} = {}) {
  return [
    ...(hats || [item('hat', 'hat', { fire: 10 })]),
    ...(capes || [item('cape', 'cape', { ap: 1, fire: 10 })]),
    ...(amulets || [item('amulet', 'amulet', { ap: 1, fire: 10 })]),
    ...(rings || [item('ring-a', 'ring', { fire: 10 }), item('ring-b', 'ring', { fire: 10 })]),
    ...(belts || [item('belt', 'belt', { fire: 10 })]),
    ...(boots || [item('boots', 'boots', { fire: 10 })]),
    ...(weapons || [item('weapon', 'weapon', { ap: 1, fire: 10 })]),
    ...(shields || [item('shield', 'shield', { ap: 1, fire: 10 })]),
    ...(companions || [item('companion', 'companion', { fire: 10 })]),
    ...(dofuses || defaultDofus())
  ];
}
function rescueOptions(items, constraints, { sets = [], spell = fireSpell, ...extra } = {}) {
  return {
    items,
    sets,
    selections: selectionsFor(spell),
    constraints,
    fmPolicy: { spellDamagePct: 0, allowCritDamage: false, critDamageAmount: 8, exoAp: 0, exoMp: 0 },
    turnMode: 't1',
    scenario: { requiredApByTurn: {} },
    searchProfile: 'BALANCED',
    ...extra
  };
}
function runRescue(items, constraints, extra = {}) {
  return searchConstraintCompletenessRescue(rescueOptions(items, constraints, extra));
}
function ids(build) {
  return new Set((build?.items || []).map((entry) => String(entry.id)));
}
function firstHint(output, key) {
  return output.diagnostics?.[key]?.[0]?.id || null;
}

const setA = { id: 'set-a', name: 'Set A', bonuses: { 2: { fire: 90 } } };
const setB = { id: 'set-b', name: 'Set B', bonuses: { 2: { fire: 15, range: 3 } } };
function twoSetShape() {
  return fixedShape({
    hats: [
      item('a-hat', 'hat', { ap: 1, fire: 90 }, { setId: 'set-a' }),
      item('b-hat', 'hat', { ap: 1, fire: 25 }, { setId: 'set-b' })
    ],
    belts: [
      item('a-belt', 'belt', { fire: 90 }, { setId: 'set-a' }),
      item('b-belt', 'belt', { fire: 25 }, { setId: 'set-b' })
    ]
  });
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

test('T1 guided rescue explores all equipment before companion and Dofus completion', () => {
  const output = runRescue(fixedShape({ hats: [item('ap-hat', 'hat', { ap: 1, fire: 20 })] }), { ap: 12 }, {
    debugExplorationHints: true
  });
  const order = output.diagnostics.constraintRescueGroupOrder;
  const companion = order.indexOf('companion');
  const dofus = order.indexOf('dofus');
  assert.ok(companion > 0);
  assert.equal(dofus, order.length - 1, `Dofus must be the T1 completion group: ${order.join(' -> ')}`);
  for (const slot of ['hat', 'cape', 'amulet', 'ring', 'belt', 'boots', 'weapon', 'shield']) {
    assert.ok(order.indexOf(slot) < companion, `${slot} must be explored before companion`);
  }
});

test('stronger offensive set core ranks first without an extra constraint', () => {
  const output = runRescue(twoSetShape(), { ap: 12 }, {
    sets: [setA, setB],
    debugExplorationHints: true,
    useOffensiveBound: false
  });
  assert.equal(output.diagnostics.topSetExplorationHints[0].setId, 'set-a');
});

test('an active hard-floor constraint can reorder set exploration without deleting the stronger branch', () => {
  const output = runRescue(twoSetShape(), { ap: 12, range: 3 }, {
    sets: [setA, setB],
    debugExplorationHints: true,
    useOffensiveBound: false
  });
  assert.equal(output.diagnostics.topSetExplorationHints[0].setId, 'set-b');
  assert.ok(output.diagnostics.topSetExplorationHints.some((hint) => hint.setId === 'set-a'));
  assert.ok(ids(output.results[0]).has('b-hat'));
  assert.ok(ids(output.results[0]).has('b-belt'));
});

test('Dofus completion becomes AP-deficit aware only after equipment structure is known', () => {
  const dofuses = [
    item('dofus-ap', 'dofus', { ap: 1 }, { typeName: 'Dofus' }),
    item('dofus-damage', 'dofus', { fire: 100 }, { typeName: 'Dofus' }),
    ...Array.from({ length: 5 }, (_, index) => item(`dofus-fill-${index}`, 'dofus', { fire: 5 }, { typeName: 'Dofus' }))
  ];
  const missingAp = runRescue(fixedShape({ dofuses }), { ap: 12 }, {
    debugExplorationHints: true,
    useOffensiveBound: false
  });
  assert.equal(firstHint(missingAp, 'topDofusExplorationHints'), 'dofus-ap');

  const apSatisfied = runRescue(fixedShape({ hats: [item('ap-hat', 'hat', { ap: 1 })], dofuses }), { ap: 12 }, {
    debugExplorationHints: true,
    useOffensiveBound: false
  });
  assert.equal(firstHint(apSatisfied, 'topDofusExplorationHints'), 'dofus-damage');
});

test('companion exploration responds generically to crit saturation, crit deficit and Vitality floor', () => {
  const companions = [
    item('raw-offense-companion', 'companion', { fire: 90 }),
    item('crit-companion', 'companion', { crit: 100 }),
    item('vitality-companion', 'companion', { vit: 1400, fire: 10 })
  ];
  const deficient = runRescue(fixedShape({ hats: [item('ap-hat', 'hat', { ap: 1 })], companions }), { ap: 12 }, {
    spell: critSpell,
    debugExplorationHints: true,
    useOffensiveBound: false
  });
  assert.equal(firstHint(deficient, 'topCompanionExplorationHints'), 'crit-companion');

  const saturated = runRescue(fixedShape({ hats: [item('crit-ap-hat', 'hat', { ap: 1, crit: 100 })], companions }), { ap: 12 }, {
    spell: critSpell,
    debugExplorationHints: true,
    useOffensiveBound: false
  });
  assert.equal(firstHint(saturated, 'topCompanionExplorationHints'), 'raw-offense-companion');

  const vitality = runRescue(fixedShape({ hats: [item('ap-hat', 'hat', { ap: 1 })], companions }), { ap: 12, vit: 3000 }, {
    spell: critSpell,
    debugExplorationHints: true,
    useOffensiveBound: false
  });
  assert.equal(firstHint(vitality, 'topCompanionExplorationHints'), 'vitality-companion');
});

test('multi-pick feasibility bound uses only the still-accessible suffix', () => {
  const dofuses = [
    item('suffix-ap', 'dofus', { ap: 1 }, { typeName: 'Dofus' }),
    ...Array.from({ length: 6 }, (_, index) => item(`suffix-damage-${index}`, 'dofus', { fire: 20 + index }, { typeName: 'Dofus' }))
  ];
  const output = runRescue(fixedShape({ dofuses }), { ap: 12 }, {
    useOffensiveBound: false
  });
  assert.ok(output.results.length === 1);
  assert.ok(ids(output.results[0]).has('suffix-ap'));
  assert.ok(Number(output.diagnostics.constraintRescuePruneReasons?.['constraint:ap'] || 0) > 0,
    'once the AP candidate is behind startIndex, the suffix bound must stop counting it');
});

test('guided and legacy exploration orders preserve the exact final optimum', (t) => {
  const items = fixedShape({
    hats: [item('low-hat', 'hat', { ap: 1, fire: 10 }), item('high-hat', 'hat', { ap: 1, fire: 70 })],
    companions: [item('low-companion', 'companion', { fire: 10 }), item('high-companion', 'companion', { fire: 70 })],
    dofuses: [
      item('dofus-ap', 'dofus', { ap: 1 }, { typeName: 'Dofus' }),
      item('dofus-high', 'dofus', { fire: 80 }, { typeName: 'Dofus' }),
      ...Array.from({ length: 5 }, (_, index) => item(`dofus-exact-${index}`, 'dofus', { fire: 5 + index }, { typeName: 'Dofus' }))
    ]
  });
  const guided = runRescue(items, { ap: 12 }, { explorationGuidance: 'guided', useOffensiveBound: false });
  const legacy = runRescue(items, { ap: 12 }, { explorationGuidance: 'legacy', useOffensiveBound: false });
  assert.equal(guided.results[0].score, legacy.results[0].score);
  assert.deepEqual([...ids(guided.results[0])].sort(), [...ids(legacy.results[0])].sort());
  t.diagnostic(`NODES_TO_FIRST_VALID_GUIDED=${guided.diagnostics.constraintRescueFirstIncumbentAtNode}`);
  t.diagnostic(`NODES_TO_FIRST_VALID_LEGACY=${legacy.diagnostics.constraintRescueFirstIncumbentAtNode}`);
});

test('set-aware guidance reduces nodes to first valid on a constraint satisfied by a set bonus', (t) => {
  const items = twoSetShape();
  const guided = runRescue(items, { ap: 12, range: 3 }, {
    sets: [setA, setB], explorationGuidance: 'guided', useOffensiveBound: false
  });
  const legacy = runRescue(items, { ap: 12, range: 3 }, {
    sets: [setA, setB], explorationGuidance: 'legacy', useOffensiveBound: false
  });
  const after = guided.diagnostics.constraintRescueFirstIncumbentAtNode;
  const before = legacy.diagnostics.constraintRescueFirstIncumbentAtNode;
  assert.ok(Number.isFinite(after));
  assert.ok(Number.isFinite(before));
  assert.ok(after < before, `guided first valid ${after} should beat legacy ${before}`);
  assert.equal(guided.results[0].score, legacy.results[0].score);
  t.diagnostic(`NODES_TO_FIRST_VALID_BEFORE=${before}`);
  t.diagnostic(`NODES_TO_FIRST_VALID_AFTER=${after}`);
  t.diagnostic(`TOTAL_NODES_BEFORE=${legacy.diagnostics.constraintRescueNodes}`);
  t.diagnostic(`TOTAL_NODES_AFTER=${guided.diagnostics.constraintRescueNodes}`);
});
