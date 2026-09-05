import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  WORKSHOP_SLOTS,
  createWorkshopBuild,
  createWorkshopBuildFromOptimizerResult,
  equipWorkshopItem,
  rejectWorkshopItem,
  removeWorkshopItem,
  setWorkshopSlotLocked
} from '../js/workshop/workshop-build.js';
import { workshopOptimizationContext } from '../js/workshop/workshop-optimization.js';

function item(id, slot) {
  return { id, name: id, slot, level: 200, stats: {}, passives: [], conditions: null, certified: true };
}

function resultItems() {
  return WORKSHOP_SLOTS.map(({ key, slot }) => item(`item-${key}`, slot));
}

function fullWorkshopBuild({ rejectedItemIds = [] } = {}) {
  let build = createWorkshopBuild({ classId: 'iop', rejectedItemIds });
  for (const { key, slot } of WORKSHOP_SLOTS) {
    const update = equipWorkshopItem(build, key, item(`item-${key}`, slot));
    assert.equal(update.accepted, true);
    build = update.build;
  }
  return build;
}

test('complete build keeps historical improve-complete semantics', () => {
  let build = fullWorkshopBuild({ rejectedItemIds: ['forbidden-item'] });
  build = setWorkshopSlotLocked(build, 'ring-2', true);

  const context = workshopOptimizationContext(build);

  assert.equal(context.mode, 'improve-complete');
  assert.deepEqual(context.lockedItemsBySlot, { 'ring-2': 'item-ring-2' });
  assert.deepEqual(context.searchRequiredItemsBySlot, { 'ring-2': 'item-ring-2' });
  assert.deepEqual(context.rejectedItemIds, ['forbidden-item']);
  assert.ok(context.seedBuild);
  assert.equal(context.seedBuild.itemIds.length, WORKSHOP_SLOTS.length);
});

test('15 / 16 enters fill-missing and requires every currently equipped item', () => {
  const build = removeWorkshopItem(fullWorkshopBuild(), 'boots');
  const context = workshopOptimizationContext(build);

  assert.equal(context.mode, 'fill-missing');
  assert.equal(context.seedBuild, null);
  assert.equal(Object.keys(context.searchRequiredItemsBySlot).length, 15);
  assert.equal(context.searchRequiredItemsBySlot.boots, undefined);
  assert.equal(context.searchRequiredItemsBySlot.hat, 'item-hat');
});

test('multiple missing slots only require items that are still equipped', () => {
  let build = fullWorkshopBuild();
  build = removeWorkshopItem(build, 'cape');
  build = removeWorkshopItem(build, 'boots');
  build = removeWorkshopItem(build, 'dofus-6');

  const context = workshopOptimizationContext(build);

  assert.equal(context.mode, 'fill-missing');
  assert.equal(Object.keys(context.searchRequiredItemsBySlot).length, 13);
  assert.equal(context.searchRequiredItemsBySlot.cape, undefined);
  assert.equal(context.searchRequiredItemsBySlot.boots, undefined);
  assert.equal(context.searchRequiredItemsBySlot['dofus-6'], undefined);
});

test('incomplete explicit locks stay persistent while every present item is transiently required', () => {
  let build = fullWorkshopBuild();
  build = setWorkshopSlotLocked(build, 'hat', true);
  build = setWorkshopSlotLocked(build, 'ring-2', true);
  build = removeWorkshopItem(build, 'boots');

  const context = workshopOptimizationContext(build);

  assert.equal(Object.keys(context.searchRequiredItemsBySlot).length, 15);
  assert.deepEqual(context.lockedItemsBySlot, {
    hat: 'item-hat',
    'ring-2': 'item-ring-2'
  });
  assert.equal(context.searchRequiredItemsBySlot.hat, 'item-hat');
  assert.equal(context.searchRequiredItemsBySlot['ring-2'], 'item-ring-2');
});

test('rejectedItemIds are preserved in complete and fill-missing modes', () => {
  const complete = fullWorkshopBuild({ rejectedItemIds: ['z-reject', 'a-reject'] });
  const incomplete = removeWorkshopItem(complete, 'boots');

  assert.deepEqual(workshopOptimizationContext(complete).rejectedItemIds, ['a-reject', 'z-reject']);
  assert.deepEqual(workshopOptimizationContext(incomplete).rejectedItemIds, ['a-reject', 'z-reject']);
});

test('Optimizer return persists only explicit locks, never transient fill-missing requirements', () => {
  let incomplete = fullWorkshopBuild({ rejectedItemIds: ['forbidden-item'] });
  incomplete = setWorkshopSlotLocked(incomplete, 'hat', true);
  incomplete = setWorkshopSlotLocked(incomplete, 'ring-2', true);
  incomplete = removeWorkshopItem(incomplete, 'boots');
  const context = workshopOptimizationContext(incomplete);

  assert.equal(Object.keys(context.searchRequiredItemsBySlot).length, 15);
  assert.equal(Object.keys(context.lockedItemsBySlot).length, 2);

  const returned = createWorkshopBuildFromOptimizerResult({
    result: { items: resultItems() },
    classId: 'iop',
    lockedItemsBySlot: context.lockedItemsBySlot,
    rejectedItemIds: context.rejectedItemIds
  });

  assert.deepEqual(returned.lockedSlots, ['hat', 'ring-2']);
  assert.deepEqual(returned.rejectedItemIds, ['forbidden-item']);
});

test('remove frees the slot and lock without adding a rejected item', () => {
  let build = fullWorkshopBuild({ rejectedItemIds: ['already-rejected'] });
  build = setWorkshopSlotLocked(build, 'hat', true);

  const removed = removeWorkshopItem(build, 'hat');

  assert.equal(removed.equipmentBySlot.hat, undefined);
  assert.equal(removed.lockedSlots.includes('hat'), false);
  assert.deepEqual(removed.rejectedItemIds, ['already-rejected']);
});

test('reject frees the slot and lock and adds the item id to rejectedItemIds', () => {
  let build = fullWorkshopBuild({ rejectedItemIds: ['already-rejected'] });
  build = setWorkshopSlotLocked(build, 'hat', true);

  const rejected = rejectWorkshopItem(build, 'hat');

  assert.equal(rejected.equipmentBySlot.hat, undefined);
  assert.equal(rejected.lockedSlots.includes('hat'), false);
  assert.deepEqual(rejected.rejectedItemIds, ['already-rejected', 'item-hat']);
});

test('UI and Optimizer bridge expose fill-missing without persisting transient requirements', async () => {
  const [workshopSource, optimizerSource] = await Promise.all([
    readFile(new URL('../js/workshop/workshop-app.js', import.meta.url), 'utf8'),
    readFile(new URL('../js/optimizer-v2-app.js', import.meta.url), 'utf8')
  ]);

  assert.match(workshopSource, /Compléter le stuff/);
  assert.match(workshopSource, /item\(s\) conservé\(s\).*slot\(s\) à compléter/);
  assert.match(optimizerSource, /lockedItemsBySlot:\s*refinement\?\.searchRequiredItemsBySlot\s*\|\|\s*\{\}/);
  assert.match(optimizerSource, /currentPersistentLockedItemsBySlot/);
  assert.match(optimizerSource, /lockedItemsBySlot:\s*currentPersistentLockedItemsBySlot/);
});
