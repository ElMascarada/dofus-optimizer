import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  WORKSHOP_SLOTS,
  createWorkshopBuild,
  equipWorkshopItem,
  removeWorkshopItem,
  workshopItems
} from '../js/workshop/workshop-build.js';
import { evaluateWorkshopBuild } from '../js/workshop/workshop-evaluator.js';
import { WorkshopController } from '../js/workshop/workshop-controller.js';

function item(id, slot, stats = {}, extra = {}) {
  return { id, name: id, slot, stats, passives: [], conditions: null, certified: true, ...extra };
}

const character = {
  level: 200,
  characteristicPoints: 0,
  scrolled: {},
  baseStats: { ap: 8, mp: 4, vit: 1000 }
};
const spell = {
  id: 'spell-fire',
  name: 'Feu test',
  breedId: 'breed-test',
  apCost: 3,
  baseCritPct: 10,
  minRange: 1,
  maxRange: 5,
  distanceOptions: ['ranged'],
  hits: [{ element: 'fire', normal: [10, 20], crit: [12, 24] }],
  combatModifiers: [],
  certified: true,
  damageSource: 'spell'
};
const spellData = {
  breeds: [{ id: 'breed-test', name: 'Classe test', spellIds: [spell.id] }],
  spells: [spell]
};
const set = { id: 'set-a', name: 'Panoplie A', bonuses: { '2': { power: 20, vit: 50 } } };
const dataset = { sets: [set] };

function evaluate(build) {
  return evaluateWorkshopBuild({ build, dataset, spellData, character });
}

test('équipe, remplace et retire un item sans muter l’état précédent', () => {
  const initial = createWorkshopBuild();
  const first = item('hat-a', 'hat', { fire: 50 });
  const second = item('hat-b', 'hat', { fire: 100 });
  const equipped = equipWorkshopItem(initial, 'hat', first);
  const replaced = equipWorkshopItem(equipped.build, 'hat', second);
  const removed = removeWorkshopItem(replaced.build, 'hat');
  assert.equal(equipped.accepted, true);
  assert.equal(initial.equipmentBySlot.hat, undefined);
  assert.equal(replaced.build.equipmentBySlot.hat.id, 'hat-b');
  assert.equal(removed.equipmentBySlot.hat, undefined);
});

test('les deux anneaux sont deux emplacements canoniques distincts', () => {
  let build = createWorkshopBuild();
  build = equipWorkshopItem(build, 'ring-1', item('ring-a', 'ring')).build;
  build = equipWorkshopItem(build, 'ring-2', item('ring-b', 'ring')).build;
  assert.equal(build.equipmentBySlot['ring-1'].id, 'ring-a');
  assert.equal(build.equipmentBySlot['ring-2'].id, 'ring-b');
  assert.equal(workshopItems(build).filter((entry) => entry.slot === 'ring').length, 2);
});

test('le build expose exactement six slots Dofus/trophées', () => {
  const keys = WORKSHOP_SLOTS.filter((entry) => entry.slot === 'dofus').map((entry) => entry.key);
  assert.equal(keys.length, 6);
  let build = createWorkshopBuild();
  for (let index = 0; index < keys.length; index++) {
    const update = equipWorkshopItem(build, keys[index], item(`dofus-${index}`, 'dofus'));
    assert.equal(update.accepted, true);
    build = update.build;
  }
  assert.equal(workshopItems(build).filter((entry) => entry.slot === 'dofus').length, 6);
});

test('la restriction Prysmaradite canonique refuse une deuxième Prysmaradite', () => {
  const first = item('prysma-a', 'dofus', {}, { slotSubtype: 'prysmaradite' });
  const second = item('prysma-b', 'dofus', {}, { slotSubtype: 'prysmaradite' });
  const once = equipWorkshopItem(createWorkshopBuild(), 'dofus-1', first);
  const twice = equipWorkshopItem(once.build, 'dofus-2', second);
  assert.equal(once.accepted, true);
  assert.equal(twice.accepted, false);
  assert.equal(twice.reason, 'special-slot-rule');
  assert.equal(workshopItems(twice.build).length, 1);
});

test('le bonus de panoplie vient de CompleteBuildEvaluator', () => {
  let build = createWorkshopBuild({ classId: 'breed-test' });
  build = equipWorkshopItem(build, 'hat', item('set-hat', 'hat', { fire: 30 }, { setId: 'set-a' })).build;
  build = equipWorkshopItem(build, 'cape', item('set-cape', 'cape', { fire: 20 }, { setId: 'set-a' })).build;
  const result = evaluate(build);
  assert.equal(result.valid, true);
  assert.equal(result.stats.fire, 50);
  assert.equal(result.stats.power, 20);
  assert.equal(result.stats.vit, 1050);
  assert.deepEqual(result.activeSets.map(({ setId, count }) => ({ setId, count })), [{ setId: 'set-a', count: 2 }]);
});

test('les stats sont recalculées après remplacement d’un item', () => {
  let build = createWorkshopBuild({ classId: 'breed-test' });
  build = equipWorkshopItem(build, 'hat', item('weak', 'hat', { fire: 20, initiative: 100 })).build;
  const weak = evaluate(build);
  build = equipWorkshopItem(build, 'hat', item('strong', 'hat', { fire: 120, initiative: 500 })).build;
  const strong = evaluate(build);
  assert.equal(weak.stats.fire, 20);
  assert.equal(strong.stats.fire, 120);
  assert.equal(strong.stats.initiative, 500);
});

test('les dégâts exacts d’un sort changent avec les stats du build', () => {
  let build = createWorkshopBuild({ classId: 'breed-test' });
  const baseline = evaluate(build);
  build = equipWorkshopItem(build, 'hat', item('fire-hat', 'hat', { fire: 100 })).build;
  const boosted = evaluate(build);
  const before = baseline.spells[0].evaluation.normalDamage;
  const after = boosted.spells[0].evaluation.normalDamage;
  assert.deepEqual(before, [10, 20]);
  assert.deepEqual(after, [20, 40]);
});

test('la probabilité critique affichée vient du moteur de sorts', () => {
  let build = createWorkshopBuild({ classId: 'breed-test' });
  build = equipWorkshopItem(build, 'hat', item('crit-hat', 'hat', { crit: 20 })).build;
  const result = evaluate(build);
  assert.equal(result.spells[0].evaluation.critChancePct, 30);
  assert.deepEqual(result.spells[0].evaluation.criticalDamage, [12, 24]);
});

test('changer un item dans WorkshopController ne crée aucun optimizer Worker', () => {
  const originalWorker = globalThis.Worker;
  let workerCalls = 0;
  globalThis.Worker = class { constructor() { workerCalls++; } };
  try {
    const controller = new WorkshopController({
      dataset: { sets: [] },
      spellData: { breeds: [], spells: [] },
      evaluate: () => ({ valid: true, stats: {}, activeSets: [], spells: [], recalculationMs: 0 })
    });
    controller.equip('hat', item('hat', 'hat', { fire: 50 }));
    controller.remove('hat');
    assert.equal(workerCalls, 0);
  } finally {
    if (originalWorker === undefined) delete globalThis.Worker;
    else globalThis.Worker = originalWorker;
  }
});

test('le shell conserve l’ancien Optimiseur et son bootstrap historique', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /id="workshop-view"/);
  assert.match(html, /id="optimizer-view"/);
  assert.match(html, /id="optimize"/);
  assert.match(html, /js\/app-experimental\.js/);
  assert.match(html, /data-product-tab="optimizer"/);
});
