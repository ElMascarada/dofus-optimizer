import assert from 'node:assert/strict';
import test from 'node:test';
import { BASE_CHARACTER } from '../js/config.js';
import { evaluateCompleteEquipmentBuild } from '../js/complete-equipment-build-evaluator.js';
import {
  WORKSHOP_SLOTS,
  createWorkshopBuildFromOptimizerResult,
  equipWorkshopItem
} from '../js/workshop/workshop-build.js';
import { evaluateWorkshopBuild } from '../js/workshop/workshop-evaluator.js';
import {
  rehydrateWorkshopBuild,
  serializeWorkshopBuild
} from '../js/workshop/build-serialization.js';

function item(id, slot, stats = {}) {
  return {
    id,
    name: id,
    slot,
    level: 200,
    stats,
    passives: [],
    conditions: null,
    certified: true
  };
}

function completeItems() {
  const items = [];
  for (const { key, slot } of WORKSHOP_SLOTS) {
    const stats = key === 'hat'
      ? { ap: 5, mp: 2, earth: 100, water: 100, air: 100, power: 50, crit: 20, critDamage: 40 }
      : {};
    items.push(item(`workspace-${key}`, slot, stats));
  }
  return items;
}

const constraints = Object.freeze({ ap: 12, mp: 5 });
const fmPolicy = Object.freeze({ enabled: false, fmEnabled: false, exoAp: 0, exoMp: 0 });
const syntheticOffense = Object.freeze({ elements: ['earth', 'water', 'air'], profiles: ['large'], critMode: 'crit' });
const dataset = Object.freeze({ sets: [] });
const spellData = Object.freeze({ breeds: [], spells: [] });

test('un résultat Optimiseur garde exactement le même score dans le Workspace éditable', () => {
  const items = completeItems();
  const direct = evaluateCompleteEquipmentBuild({
    items,
    sets: dataset.sets,
    constraints,
    fmPolicy,
    syntheticOffense,
    character: BASE_CHARACTER
  });
  assert.ok(direct.result);

  const referenceScore = direct.result.syntheticOffense.minimumScore;
  const build = createWorkshopBuildFromOptimizerResult({
    result: {
      ...direct.result,
      workspaceContext: { constraints, fmPolicy, syntheticOffense, referenceScore }
    },
    fmPolicy
  });
  const workshop = evaluateWorkshopBuild({ build, dataset, spellData, character: BASE_CHARACTER });

  assert.equal(workshop.valid, true);
  assert.equal(workshop.combatEvaluationSource, 'optimizer-canonical-equipment');
  assert.equal(workshop.theoreticalDamage, referenceScore);
  assert.deepEqual(workshop.characteristics, direct.result.characteristics);
  assert.deepEqual(workshop.fm, direct.result.fm);
  assert.deepEqual(workshop.stats, direct.result.stats);
});

test('modifier un item conserve le contexte et recalcule le score avec le même évaluateur', () => {
  const items = completeItems();
  const direct = evaluateCompleteEquipmentBuild({
    items,
    sets: dataset.sets,
    constraints,
    fmPolicy,
    syntheticOffense,
    character: BASE_CHARACTER
  });
  assert.ok(direct.result);
  const referenceScore = direct.result.syntheticOffense.minimumScore;
  const original = createWorkshopBuildFromOptimizerResult({
    result: {
      ...direct.result,
      workspaceContext: { constraints, fmPolicy, syntheticOffense, referenceScore }
    },
    fmPolicy
  });

  const replacement = item('workspace-cape-stronger', 'cape', { power: 100 });
  const update = equipWorkshopItem(original, 'cape', replacement);
  assert.equal(update.accepted, true);
  assert.deepEqual(update.build.workspaceContext?.constraints, constraints);
  assert.deepEqual(update.build.workspaceContext?.syntheticOffense, syntheticOffense);

  const edited = evaluateWorkshopBuild({ build: update.build, dataset, spellData, character: BASE_CHARACTER });
  assert.equal(edited.valid, true);
  assert.equal(edited.referenceScore, referenceScore);
  assert.ok(edited.theoreticalDamage > referenceScore);
});

test('le contexte de score survit à la sauvegarde et au rechargement Atelier', () => {
  const items = completeItems();
  const direct = evaluateCompleteEquipmentBuild({
    items,
    sets: dataset.sets,
    constraints,
    fmPolicy,
    syntheticOffense,
    character: BASE_CHARACTER
  });
  const referenceScore = direct.result.syntheticOffense.minimumScore;
  const build = createWorkshopBuildFromOptimizerResult({
    result: {
      ...direct.result,
      workspaceContext: { constraints, fmPolicy, syntheticOffense, referenceScore }
    },
    fmPolicy
  });
  const snapshot = serializeWorkshopBuild(build, { dataVersion: 'test' });
  const hydrated = rehydrateWorkshopBuild(snapshot, { items });

  assert.deepEqual(hydrated.build.workspaceContext?.constraints, constraints);
  assert.deepEqual(hydrated.build.workspaceContext?.syntheticOffense, syntheticOffense);
  assert.equal(hydrated.build.workspaceContext?.referenceScore, referenceScore);
});
