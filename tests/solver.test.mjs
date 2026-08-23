import test from 'node:test';
import assert from 'node:assert/strict';
import { optimizeBuild } from '../js/solver.js';

const spell = { id: 's', name: 'S', baseCritPct: 0, hits: [{ element: 'earth', normal: [10, 10] }] };
const selections = [{ enabled: true, weight: 1, spell, casts: { 1: 1, 2: 1, 3: 1 } }];
const fmPolicy = { spellDamagePct: 3, allowCritDamage: false, critDamageAmount: 8 };
const noPoints = { level: 200, characteristicPoints: 0, scrolled: {}, baseStats: {} };

test('solver respects a hard resistance constraint, ranks damage and deduplicates seed/exact results', () => {
  const items = [
    { id: 'h1', name: 'Damage', slot: 'hat', stats: { earth: 100 } },
    { id: 'h2', name: 'Res', slot: 'hat', stats: { earth: 20, resEarth: 40 } }
  ];
  const output = optimizeBuild({
    items,
    sets: [],
    selections,
    constraints: { resEarth: 40 },
    fmPolicy,
    slotRules: [{ id: 'hat', count: 1 }],
    character: noPoints,
    topN: 5
  });
  assert.equal(output.results.length, 1);
  assert.equal(output.results[0].items[0].id, 'h2');
});

test('a requested slot with too few candidates makes the search impossible', () => {
  const output = optimizeBuild({
    items: [{ id: 'd1', slot: 'dofus', stats: { power: 100 } }],
    sets: [],
    selections,
    constraints: {},
    fmPolicy,
    slotRules: [{ id: 'dofus', count: 2 }],
    character: noPoints
  });
  assert.equal(output.results.length, 0);
  assert.equal(output.diagnostics.impossible, true);
});

test('constraint pruning remains safe when a set bonus is required to become legal', () => {
  const items = [
    { id: 'h', slot: 'hat', setId: 'set-a', stats: { earth: 20 } },
    { id: 'c', slot: 'cape', setId: 'set-a', stats: { earth: 20 } }
  ];
  const sets = [{ id: 'set-a', name: 'A', bonuses: { '2': { ap: 1 } } }];
  const output = optimizeBuild({
    items,
    sets,
    selections,
    constraints: { ap: 12 },
    fmPolicy,
    slotRules: [{ id: 'hat', count: 1 }, { id: 'cape', count: 1 }],
    character: { ...noPoints, baseStats: { ap: 11 } },
    topN: 1
  });
  assert.equal(output.results.length, 1);
  assert.equal(output.results[0].stats.ap, 12);
  assert.equal(output.results[0].activeSets[0].count, 2);
});

test('solver can complete a six-Dofus group after preprocessing', () => {
  const items = Array.from({ length: 6 }, (_, index) => ({
    id: `small-d-${index}`,
    slot: 'dofus',
    stats: { power: 100 - index }
  }));
  const output = optimizeBuild({
    items,
    sets: [],
    selections,
    constraints: {},
    fmPolicy,
    slotRules: [{ id: 'dofus', count: 6 }],
    character: noPoints,
    topN: 1
  });
  assert.equal(output.results.length, 1);
});

test('huge six-Dofus space keeps the exact optimum without expanding the theoretical combination space', () => {
  const items = Array.from({ length: 320 }, (_, index) => ({
    id: `d-${index}`,
    slot: 'dofus',
    stats: { power: 320 - index }
  }));
  const output = optimizeBuild({
    items,
    sets: [],
    selections,
    constraints: {},
    fmPolicy,
    slotRules: [{ id: 'dofus', count: 6 }],
    character: noPoints,
    topN: 1
  });
  assert.equal(output.results.length, 1);
  assert.deepEqual(output.results[0].items.map((entry) => entry.id), ['d-0', 'd-1', 'd-2', 'd-3', 'd-4', 'd-5']);
  const group = output.diagnostics.groups[0];
  assert.equal(group.theoreticalChoicesBefore, '1422630723360');
  assert.equal(group.candidates, 6);
  // A strong seed may prove the optimum at the root, in which case the dynamic
  // Pareto frontier is never materialized at all. Zero or one choice are both valid.
  assert.ok(group.materializedChoices <= 1);
  assert.ok(BigInt(group.materializedChoices) < BigInt(group.theoreticalChoicesBefore));
});