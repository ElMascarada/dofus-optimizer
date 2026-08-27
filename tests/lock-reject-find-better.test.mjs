import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { createOptimizerV2Request } from '../js/optimizer-v2-orchestrator.js';
import { normalizeSearchQuery, searchFingerprint, searchQueryDistance } from '../js/search-memory/search-query.js';
import { evaluateSearchSeedBuilds } from '../js/search-memory/search-seeds.js';
import {
  WORKSHOP_SLOTS,
  createWorkshopBuild,
  createWorkshopBuildFromOptimizerResult,
  equipWorkshopItem,
  rejectWorkshopItem,
  setWorkshopSlotLocked
} from '../js/workshop/workshop-build.js';
import { workshopOptimizationContext } from '../js/workshop/workshop-optimization.js';
import { rehydrateWorkshopBuild, serializeWorkshopBuild } from '../js/workshop/build-serialization.js';

function item(id, slot, stats = {}) {
  return { id, name: id, slot, level: 200, stats, passives: [], conditions: null, certified: true };
}

const spellData = {
  breeds: [{ id: 'iop', name: 'Iop', spellIds: ['earth-hit'] }],
  spells: [{ id: 'earth-hit', name: 'Terre', hits: [{ element: 'earth', min: 20, max: 20 }], combatModifiers: [] }]
};

function fullItems() {
  return [
    item('hat', 'hat'), item('cape', 'cape'), item('amulet', 'amulet'),
    item('ring-a', 'ring'), item('ring-b', 'ring'), item('belt', 'belt'),
    item('boots', 'boots'), item('weapon', 'weapon'), item('shield', 'shield'),
    item('companion', 'companion'),
    ...Array.from({ length: 6 }, (_, index) => item(`dofus-${index + 1}`, 'dofus'))
  ];
}

function fullWorkshopBuild() {
  const items = fullItems();
  let build = createWorkshopBuild({ classId: 'iop' });
  let cursor = 0;
  for (const descriptor of WORKSHOP_SLOTS) {
    const candidate = items.slice(cursor).find((entry) => entry.slot === descriptor.slot);
    const candidateIndex = items.indexOf(candidate);
    const update = equipWorkshopItem(build, descriptor.key, candidate);
    assert.equal(update.accepted, true);
    build = update.build;
    items.splice(candidateIndex, 1);
  }
  return build;
}

test('Lock conserve le slot explicite et Reject retire puis blackliste l’item', () => {
  let build = createWorkshopBuild({ classId: 'iop' });
  build = equipWorkshopItem(build, 'ring-2', item('ring-b', 'ring')).build;
  build = setWorkshopSlotLocked(build, 'ring-2', true);
  assert.deepEqual(build.lockedSlots, ['ring-2']);

  build = rejectWorkshopItem(build, 'ring-2');
  assert.equal(build.equipmentBySlot['ring-2'], undefined);
  assert.deepEqual(build.lockedSlots, []);
  assert.deepEqual(build.rejectedItemIds, ['ring-b']);
});

test('le snapshot Atelier persiste Lock/Reject et les réhydrate contre le catalogue courant', () => {
  let build = createWorkshopBuild({ classId: 'iop', rejectedItemIds: ['old-dofus'] });
  build = equipWorkshopItem(build, 'hat', item('locked-hat', 'hat')).build;
  build = setWorkshopSlotLocked(build, 'hat', true);
  const snapshot = serializeWorkshopBuild(build, { dataVersion: 'v-lock' });
  assert.deepEqual(snapshot.lockedSlots, ['hat']);
  assert.deepEqual(snapshot.rejectedItemIds, ['old-dofus']);

  const hydrated = rehydrateWorkshopBuild(snapshot, { items: [item('locked-hat', 'hat')] });
  assert.deepEqual(hydrated.build.lockedSlots, ['hat']);
  assert.deepEqual(hydrated.build.rejectedItemIds, ['old-dofus']);
});

test('la requête V2 transforme les locks en requiredItemIds et exclut strictement les rejects du catalogue', () => {
  const dataset = { items: [item('locked-hat', 'hat'), item('rejected-dofus', 'dofus'), item('cape', 'cape')], sets: [] };
  const payload = createOptimizerV2Request({
    dataset,
    spellData,
    classId: 'iop',
    lockedItemsBySlot: { hat: 'locked-hat' },
    rejectedItemIds: ['rejected-dofus']
  });
  assert.deepEqual(payload.requiredItemIds, ['locked-hat']);
  assert.deepEqual(payload.lockedItemsBySlot, { hat: 'locked-hat' });
  assert.deepEqual(payload.rejectedItemIds, ['rejected-dofus']);
  assert.equal(payload.items.some((entry) => entry.id === 'rejected-dofus'), false);
  assert.throws(() => createOptimizerV2Request({
    dataset,
    spellData,
    classId: 'iop',
    lockedItemsBySlot: { hat: 'locked-hat' },
    rejectedItemIds: ['locked-hat']
  }), /à la fois locké et rejeté/);
});

test('Lock/Reject invalident la compatibilité cache mais le seed Atelier ne pollue pas le fingerprint', () => {
  const versions = { data: 'd', rules: 'r', search: 's' };
  const basePayload = {
    classId: 'iop', objectiveMode: 'combat', combatObjective: { element: 'earth', turnMode: 'sum' },
    constraints: {}, fmPolicy: {}, scenario: {}, diversityMode: 'gear', searchProfile: 'BALANCED', topN: 10,
    requiredItemIds: ['hat'], lockedItemsBySlot: { hat: 'hat' }, rejectedItemIds: ['dofus-x']
  };
  const first = normalizeSearchQuery({ payload: { ...basePayload, seedItemIds: ['seed-a'] }, versions });
  const sameConstraintsNewSeed = normalizeSearchQuery({ payload: { ...basePayload, seedItemIds: ['seed-b'] }, versions });
  const changedReject = normalizeSearchQuery({ payload: { ...basePayload, rejectedItemIds: ['dofus-y'] }, versions });
  assert.equal(searchFingerprint(first), searchFingerprint(sameConstraintsNewSeed));
  assert.equal(searchQueryDistance(first, sameConstraintsNewSeed), 0);
  assert.equal(searchQueryDistance(first, changedReject), Infinity);
});

test('les seeds incompatibles avec Lock/Reject sont éliminés avant CompleteBuildEvaluator', () => {
  const items = fullItems();
  let evaluatorCalls = 0;
  const baseIds = items.map((entry) => entry.id);
  const output = evaluateSearchSeedBuilds({
    seedBuilds: [
      { itemIds: baseIds, sourceFingerprint: 'valid' },
      { itemIds: baseIds.filter((id) => id !== 'hat'), sourceFingerprint: 'missing-lock' }
    ],
    items,
    requiredItemIds: ['hat'],
    rejectedItemIds: ['dofus-6'],
    evaluate() {
      evaluatorCalls++;
      return { result: { score: 1, items } };
    }
  });
  assert.equal(evaluatorCalls, 0);
  assert.equal(output.results.length, 0);
  assert.equal(output.diagnostics.rejected['rejected-item'], 1);
  assert.equal(output.diagnostics.rejected['missing-required-item'], 1);
});

test('Trouver mieux produit un seed complet sans transformer les slots non lockés en contraintes', () => {
  let build = fullWorkshopBuild();
  build = setWorkshopSlotLocked(build, 'ring-2', true);
  build = createWorkshopBuild({ ...build, rejectedItemIds: ['forbidden-dofus'] });
  const context = workshopOptimizationContext(build);
  assert.ok(context.seedBuild);
  assert.equal(context.seedBuild.itemIds.length, WORKSHOP_SLOTS.length);
  assert.deepEqual(context.lockedItemsBySlot, { 'ring-2': 'ring-b' });
  assert.deepEqual(context.rejectedItemIds, ['forbidden-dofus']);
  assert.equal(Object.keys(context.lockedItemsBySlot).length, 1);
});

test('un résultat réoptimisé remet l’item locké dans son slot Atelier exact', () => {
  const resultItems = fullItems();
  const build = createWorkshopBuildFromOptimizerResult({
    result: { items: resultItems },
    classId: 'iop',
    lockedItemsBySlot: { 'ring-2': 'ring-b' },
    rejectedItemIds: ['old-dofus']
  });
  assert.equal(build.equipmentBySlot['ring-2'].id, 'ring-b');
  assert.deepEqual(build.lockedSlots, ['ring-2']);
  assert.deepEqual(build.rejectedItemIds, ['old-dofus']);
});

test('l’UI expose Lock, Reject et Trouver mieux sans patch Worker global', async () => {
  const [workshopSource, optimizerSource] = await Promise.all([
    readFile(new URL('../js/workshop/workshop-app.js', import.meta.url), 'utf8'),
    readFile(new URL('../js/optimizer-v2-app.js', import.meta.url), 'utf8')
  ]);
  assert.match(workshopSource, /Trouver mieux/);
  assert.match(workshopSource, /FIND_BETTER_BUILD_EVENT/);
  assert.match(optimizerSource, /workshopOptimizationContext/);
  assert.match(optimizerSource, /mergeSeedDescriptors/);
  assert.doesNotMatch(workshopSource, /globalThis\.Worker|window\.Worker|Worker\.prototype/);
});
