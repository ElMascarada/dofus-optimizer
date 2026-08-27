import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  createOptimizerV2Request,
  normalizeOptimizerV2Constraints
} from '../js/optimizer-v2-orchestrator.js';
import { evaluateCompleteBuild } from '../js/complete-build-evaluator.js';
import { createWorkshopBuildFromOptimizerResult } from '../js/workshop/workshop-build.js';
import { rehydrateWorkshopBuild, serializeWorkshopBuild } from '../js/workshop/build-serialization.js';

const item = (id, slot, stats = {}) => ({
  id,
  name: id,
  slot,
  level: 200,
  stats,
  passives: [],
  conditions: null,
  certified: true
});

const spells = [
  { id: 'iop-earth', name: 'Terre', hits: [{ element: 'earth', min: 20, max: 20 }], combatModifiers: [] },
  { id: 'iop-fire', name: 'Feu', hits: [{ element: 'fire', min: 20, max: 20 }], combatModifiers: [] },
  { id: 'iop-support', name: 'Support', hits: [], combatModifiers: [{ kind: 'power', value: 10 }] },
  { id: 'cra-earth', name: 'Cra Terre', hits: [{ element: 'earth', min: 20, max: 20 }], combatModifiers: [] }
];
const spellData = {
  breeds: [
    { id: 'iop', name: 'Iop', spellIds: ['iop-earth', 'iop-fire', 'iop-support'] },
    { id: 'cra', name: 'Cra', spellIds: ['cra-earth'] }
  ],
  spells
};
const dataset = { items: [item('hat', 'hat')], sets: [] };

function request(overrides = {}) {
  return createOptimizerV2Request({
    dataset,
    spellData,
    classId: 'iop',
    element: 'earth',
    constraints: {},
    turnMode: 'sum',
    ...overrides
  });
}

test('le choix de classe limite la requête V2 aux sorts de cette classe', () => {
  const payload = request();
  assert.deepEqual(payload.classSpells.map((spell) => spell.id), ['iop-earth', 'iop-support']);
  assert.equal(payload.classSpells.some((spell) => spell.id === 'cra-earth'), false);
});

test('le choix élément est transmis au moteur et Multi conserve le panel offensif', () => {
  assert.equal(request({ element: 'fire' }).combatObjective.element, 'fire');
  const multi = request({ element: 'multi' });
  assert.deepEqual(multi.classSpells.map((spell) => spell.id), ['iop-earth', 'iop-fire', 'iop-support']);
});

test('les neuf contraintes V2 sont normalisées et transmises sans calcul UI', () => {
  const constraints = {
    ap: 12, mp: 6, range: 4, vit: 4200, initiative: 1800,
    resEarth: 20, resFire: 21, resWater: 22, resAir: 23
  };
  assert.deepEqual(normalizeOptimizerV2Constraints(constraints), constraints);
  assert.deepEqual(request({ constraints }).constraints, constraints);
});

test('les objectifs temporels existants sont transmis tels quels au contrat Worker', () => {
  for (const turnMode of ['t1', 't2', 't3', 'sum', 'average', 'min']) {
    const payload = request({ turnMode });
    assert.equal(payload.turnMode, turnMode);
    assert.equal(payload.combatObjective.turnMode, turnMode);
  }
});

test('la requête Optimiseur V2 conserve le pipeline automatique existant', () => {
  const payload = request();
  assert.equal(payload.objectiveMode, 'combat');
  assert.equal(payload.searchProfile, 'BALANCED');
  assert.equal(payload.diversityMode, 'gear');
  assert.equal(payload.combatObjective.targetMode, 'single');
  assert.equal(payload.combatObjective.metric, 'total-damage');
  assert.equal(payload.combatObjective.allowSupport, true);
  assert.equal(payload.items, dataset.items);
  assert.equal(payload.sets, dataset.sets);
  assert.equal(payload.topN, 10);
});

test('CompleteBuildEvaluator reste le garde final des contraintes, initiative comprise', () => {
  const strong = item('constraint-hat', 'hat', {
    ap: 4, mp: 2, range: 3, vit: 500, initiative: 2200,
    resEarth: 20, resFire: 20, resWater: 20, resAir: 20
  });
  const constraints = {
    ap: 12, mp: 6, range: 3, vit: 1200, initiative: 2000,
    resEarth: 20, resFire: 20, resWater: 20, resAir: 20
  };
  const valid = evaluateCompleteBuild({
    items: [strong], sets: [], selections: [], constraints,
    fmPolicy: { spellDamagePct: 0, allowCritDamage: false, structuralExos: false },
    turnMode: 't1'
  });
  assert.ok(valid.result);
  assert.ok(valid.result.stats.initiative >= constraints.initiative);

  const invalid = evaluateCompleteBuild({
    items: [{ ...strong, stats: { ...strong.stats, initiative: 1999 } }],
    sets: [], selections: [], constraints,
    fmPolicy: { spellDamagePct: 0, allowCritDamage: false, structuralExos: false },
    turnMode: 't1'
  });
  assert.equal(invalid.result, null);
  assert.equal(invalid.reason, 'constraint');
});

test('un résultat Optimiseur reconstruit un WorkshopBuild canonique et persistant', () => {
  const items = [
    item('ring-a', 'ring'), item('ring-b', 'ring'),
    ...Array.from({ length: 6 }, (_, index) => item(`dofus-${index + 1}`, 'dofus'))
  ];
  const build = createWorkshopBuildFromOptimizerResult({
    result: {
      items,
      combatPlan: { sequence: [{ id: 'iop-earth' }, { id: 'iop-earth' }, { id: 'iop-support' }] }
    },
    classId: 'iop',
    fmPolicy: { spellDamagePct: 3, allowCritDamage: true, critDamageAmount: 8, structuralExos: false }
  });
  assert.equal(build.equipmentBySlot['ring-1'].id, 'ring-a');
  assert.equal(build.equipmentBySlot['ring-2'].id, 'ring-b');
  assert.equal(build.equipmentBySlot['dofus-6'].id, 'dofus-6');
  assert.deepEqual(build.selectedSpells, ['iop-earth', 'iop-support']);

  const snapshot = serializeWorkshopBuild(build, { dataVersion: 'test-v2' });
  const hydrated = rehydrateWorkshopBuild(snapshot, { items });
  assert.equal(hydrated.degraded, false);
  assert.equal(hydrated.build.equipmentBySlot['ring-2'].id, 'ring-b');
});

test('le parcours visible est bien le V2 simplifié et ne charge plus l’ancien contrôleur UI', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  for (const id of [
    'optimizer-class', 'optimizer-element', 'optimizer-min-ap', 'optimizer-min-mp',
    'optimizer-min-range', 'optimizer-min-vit', 'optimizer-min-initiative',
    'optimizer-res-earth', 'optimizer-res-fire', 'optimizer-res-water', 'optimizer-res-air',
    'optimizer-turn-mode', 'optimizer-run', 'optimizer-results'
  ]) assert.match(html, new RegExp(`id=["']${id}["']`));
  assert.match(html, /js\/optimizer-v2-app\.js/);
  assert.doesNotMatch(html, /js\/app-experimental\.js/);
  assert.doesNotMatch(html, /id=["']spell-list["']/);
  assert.doesNotMatch(html, /id=["']fm-spell["']/);
});

test('le contrôleur UI V2 ne réimplémente ni solveur ni évaluation métier', async () => {
  const source = await readFile(new URL('../js/optimizer-v2-app.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /complete-build-evaluator|candidate-policy|set-core-catalog|architecture-search|solver\.js/);
  assert.match(source, /createOptimizerV2Request/);
  assert.match(source, /optimizer-worker\.js/);
  assert.match(source, /createWorkshopBuildFromOptimizerResult/);
  assert.match(source, /Ouvrir dans l’Atelier/);
});
