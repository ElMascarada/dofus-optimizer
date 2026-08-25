import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { searchArchitecturesV2 } from '../js/architecture-search-v2.js';

const spell = {
  id: 'earth-hit',
  name: 'Earth hit',
  apCost: 3,
  baseCritPct: 0,
  hits: [{ element: 'earth', normal: [20, 20], crit: [20, 20] }]
};
const selections = [{ enabled: true, weight: 1, spell, casts: { 1: 1, 2: 0, 3: 0 } }];
const fmPolicy = { spellDamagePct: 0, allowCritDamage: false, critDamageAmount: 8, structuralExos: false };

function item(id, slot, stats = {}) {
  return { id, name: id, slot, stats, passives: [], conditions: null, setId: null };
}

function tinyCatalog() {
  return [
    item('hat-strong', 'hat', { earth: 200 }),
    item('hat-required', 'hat', { earth: 5 }),
    item('cape', 'cape', { earth: 10 }),
    item('amulet', 'amulet', { earth: 10 }),
    item('ring-a', 'ring', { earth: 10 }),
    item('ring-b', 'ring', { earth: 10 }),
    item('belt', 'belt', { earth: 10 }),
    item('boots', 'boots', { earth: 10 }),
    item('weapon', 'weapon', { earth: 10 }),
    item('shield', 'shield', { earth: 10 }),
    item('companion', 'companion', { earth: 10 }),
    ...Array.from({ length: 6 }, (_, index) => item(`dofus-${index + 1}`, 'dofus', { earth: 5 }))
  ];
}

test('required equipment is a hard architecture anchor even when it scores worse', () => {
  const output = searchArchitecturesV2({
    items: tinyCatalog(),
    sets: [],
    selections,
    constraints: {},
    fmPolicy,
    turnMode: 't1',
    requiredItemIds: ['hat-required'],
    topN: 3
  });

  assert.ok(output.results.length > 0, 'expected at least one valid build');
  for (const build of output.results) {
    assert.ok(build.items.some((entry) => entry.id === 'hat-required'), 'every build must keep the required hat');
    assert.equal(build.items.some((entry) => entry.id === 'hat-strong'), false, 'the competing hat must not replace the required one');
  }
  assert.deepEqual(output.diagnostics.requiredItemIds, ['hat-required']);
});

test('invalid required equipment fails explicitly instead of being ignored', () => {
  const output = searchArchitecturesV2({
    items: tinyCatalog(),
    sets: [],
    selections,
    constraints: {},
    fmPolicy,
    turnMode: 't1',
    requiredItemIds: ['missing-item'],
    topN: 1
  });

  assert.equal(output.results.length, 0);
  assert.equal(output.diagnostics.impossible, true);
  assert.equal(output.diagnostics.reason, 'required-item-missing');
  assert.deepEqual(output.diagnostics.missingRequiredItemIds, ['missing-item']);
});

test('Comte Harebourg set resolves to three concrete required equipment ids', async () => {
  const data = JSON.parse(await readFile(new URL('../data/normalized/dofus-data.json', import.meta.url), 'utf8'));
  const set = data.sets.find((entry) => entry.id === 'set-270');
  assert.ok(set, 'expected set-270 in normalized data');
  assert.equal(set.name, 'Panoplie du Comte Harebourg');
  assert.deepEqual(set.equipmentIds, ['item-14076', 'item-14077', 'item-14078']);
  for (const id of set.equipmentIds) assert.ok(data.items.some((entry) => entry.id === id), `missing ${id}`);
});
