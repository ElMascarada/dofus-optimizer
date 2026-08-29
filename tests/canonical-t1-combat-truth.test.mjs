import test from 'node:test';
import assert from 'node:assert/strict';

import { optimizeCombatSequence } from '../js/turn-optimizer.js';
import {
  WORKSHOP_SLOTS,
  createWorkshopBuildFromOptimizerResult,
  equipWorkshopItem,
  workshopCombatSignature
} from '../js/workshop/workshop-build.js';
import { evaluateWorkshopBuild } from '../js/workshop/workshop-evaluator.js';
import { analyzeWorkshopTurns } from '../js/workshop/workshop-turn-analysis.js';

function item(id, slot, stats = {}) {
  return {
    id,
    name: id,
    slot,
    stats,
    passives: [],
    conditions: null,
    certified: true
  };
}

function completeItems() {
  return WORKSHOP_SLOTS.map(({ key, slot }) => item(`canonical-${key}`, slot));
}

const classId = 'iop-canonical-t1';
const spell = {
  id: 'canonical-earth-hit',
  name: 'Frappe Terre canonique',
  breedId: classId,
  apCost: 3,
  baseCritPct: 0,
  minRange: 1,
  maxRange: 6,
  distanceOptions: ['ranged'],
  hits: [{ element: 'earth', normal: [100, 100], crit: [100, 100] }],
  combatModifiers: [],
  delayedCombatModifiers: [],
  certified: true,
  combatRelevant: true,
  damageSource: 'spell'
};
const spellData = {
  breeds: [{ id: classId, name: 'Iop test', spellIds: [spell.id] }],
  spells: [spell]
};
const stats = {
  ap: 12,
  mp: 6,
  earth: 100,
  power: 200,
  damage: 20,
  initiative: 0
};
const combatObjective = {
  element: 'earth',
  turnMode: 't1',
  targetMode: 'single',
  areaTargets: 3,
  allowSupport: true,
  metric: 'total-damage'
};
const scenario = { requiredApByTurn: {} };

function canonicalOptimizerResult() {
  const combatPlan = optimizeCombatSequence({
    baseStats: stats,
    baseStatsByTurn: { 1: stats },
    spells: [spell],
    objective: combatObjective,
    beamWidth: 1400,
    interTurnWidth: 24,
    maxActionsPerTurn: 12
  });
  return {
    items: completeItems(),
    stats,
    effectiveStatsByTurn: { 1: stats },
    fm: { spellDamagePct: 0, structuralExos: false },
    score: combatPlan.score,
    perTurn: combatPlan.perTurn,
    combatPlan
  };
}

test('un résultat Optimizer T1 inchangé conserve exactement sa vérité combat dans Workshop', () => {
  const result = canonicalOptimizerResult();
  assert.equal(result.combatPlan.objective.turnMode, 't1');
  assert.ok(result.combatPlan.sequence.length > 1, 'le fixture doit certifier la multiplicité des casts');
  assert.equal(new Set(result.combatPlan.sequence.map((entry) => String(entry.spellId))).size, 1);

  const build = createWorkshopBuildFromOptimizerResult({
    result,
    classId,
    fmPolicy: { spellDamagePct: 0, allowCritDamage: false, critDamageAmount: 8, structuralExos: false },
    combatObjective,
    scenario,
    spellIds: [spell.id],
    searchProfile: 'BALANCED'
  });

  assert.equal(build.canonicalCombatContext.turnMode, 't1');
  assert.equal(build.canonicalCombatContext.element, 'earth');
  assert.deepEqual(build.canonicalCombatContext.scenario, scenario);
  assert.deepEqual(build.canonicalCombatContext.stats, stats);
  assert.deepEqual(build.canonicalCombatContext.effectiveStatsByTurn[1], stats);
  assert.deepEqual(
    build.canonicalCombatContext.plan.sequence.map((entry) => String(entry.spellId)),
    result.combatPlan.sequence.map((entry) => String(entry.spellId))
  );
  assert.equal(build.canonicalCombatSignature, workshopCombatSignature(build));

  const evaluation = evaluateWorkshopBuild({
    build,
    dataset: { sets: [] },
    spellData
  });
  assert.equal(evaluation.valid, true);
  assert.equal(evaluation.combatEvaluationSource, 'optimizer-canonical-t1');
  assert.deepEqual(evaluation.stats, result.stats);
  assert.deepEqual(evaluation.effectiveStatsByTurn[1], result.effectiveStatsByTurn[1]);

  const workshop = analyzeWorkshopTurns(evaluation);
  assert.ok(workshop);
  assert.equal(workshop.plan.objective.turnMode, 't1');
  assert.deepEqual(workshop.plan.sequence, result.combatPlan.sequence);
  assert.equal(workshop.turns.length, 1);

  const optimizerT1Damage = Number(result.combatPlan.perTurn[1]);
  const workshopT1Damage = Number(workshop.turns[0].damage);
  assert.equal(workshopT1Damage, optimizerT1Damage);
  assert.equal(workshopT1Damage - optimizerT1Damage, 0);
});

test('une modification combat dans Workshop invalide la vérité T1 importée', () => {
  const result = canonicalOptimizerResult();
  const imported = createWorkshopBuildFromOptimizerResult({
    result,
    classId,
    fmPolicy: { spellDamagePct: 0, allowCritDamage: false, critDamageAmount: 8, structuralExos: false },
    combatObjective,
    scenario,
    spellIds: [spell.id]
  });
  const changed = equipWorkshopItem(imported, 'hat', item('changed-hat', 'hat', { earth: 50 }));
  assert.equal(changed.accepted, true);
  assert.notEqual(changed.build.canonicalCombatSignature, workshopCombatSignature(changed.build));

  const evaluation = evaluateWorkshopBuild({
    build: changed.build,
    dataset: { sets: [] },
    spellData
  });
  assert.equal(evaluation.valid, true);
  assert.equal(evaluation.combatEvaluationSource, 'workshop');
  assert.equal(evaluation.canonicalCombatContext, null);
});
