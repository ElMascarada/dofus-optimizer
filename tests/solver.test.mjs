import test from 'node:test';
import assert from 'node:assert/strict';
import { optimizeBuild } from '../js/solver.js';

const spell = { id: 'spell', name: 'Spell', baseCritPct: 0, hits: [{ element: 'earth', normal: [10, 10] }] };
const selections = [{ enabled: true, weight: 1, spell, casts: { 1: 1, 2: 1, 3: 1 } }];
const fmPolicy = { spellDamagePct: 0, allowCritDamage: false, structuralExos: false };
const noPoints = { level: 200, characteristicPoints: 0, scrolled: {}, baseStats: {} };

function passiveItem({ id, passiveId, rules, stats = {}, slot = 'dofus' }) {
  return { id, name: id, slot, stats, passives: [{ id: passiveId, rules }] };
}

test('solver respects a hard resistance constraint and ranks damage', () => {
  const items = [
    { id: 'a', name: 'a', slot: 'hat', stats: { earth: 100, resEarth: 20 } },
    { id: 'b', name: 'b', slot: 'hat', stats: { earth: 300, resEarth: 0 } }
  ];
  const result = optimizeBuild({
    items,
    sets: [],
    selections,
    constraints: { resEarth: 10 },
    fmPolicy,
    slotRules: [{ id: 'hat', count: 1 }],
    character: noPoints,
    topN: 2
  });
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].items[0].id, 'a');
});

test('a requested slot with too few candidates makes the search impossible', () => {
  const result = optimizeBuild({
    items: [{ id: 'a', name: 'a', slot: 'ring', stats: {} }],
    sets: [], selections, constraints: {}, fmPolicy,
    slotRules: [{ id: 'ring', count: 2 }], character: noPoints
  });
  assert.equal(result.results.length, 0);
});

test('constraint pruning remains safe when a set bonus is required to become legal', () => {
  const items = [
    { id: 'a', name: 'a', slot: 'hat', setId: 'set', stats: {} },
    { id: 'b', name: 'b', slot: 'cape', setId: 'set', stats: {} },
    { id: 'x', name: 'x', slot: 'hat', stats: { earth: 100 } },
    { id: 'y', name: 'y', slot: 'cape', stats: { earth: 100 } }
  ];
  const sets = [{ id: 'set', bonuses: { 2: { resEarth: 40, earth: 500 } } }];
  const result = optimizeBuild({
    items, sets, selections,
    constraints: { resEarth: 40 }, fmPolicy,
    slotRules: [{ id: 'hat', count: 1 }, { id: 'cape', count: 1 }],
    character: noPoints, topN: 1
  });
  assert.equal(result.results.length, 1);
  assert.deepEqual(result.results[0].items.map((item) => item.id).sort(), ['a', 'b']);
});

test('huge six-Dofus combination space is not materialized and dominance keeps the exact optimum', () => {
  const items = [];
  for (let index = 0; index < 60; index++) items.push({ id: `d-${index}`, name: `d-${index}`, slot: 'dofus', stats: { earth: index } });
  const result = optimizeBuild({
    items, sets: [], selections, constraints: {}, fmPolicy,
    slotRules: [{ id: 'dofus', count: 6 }], character: noPoints, topN: 1
  });
  assert.equal(result.results.length, 1);
  assert.deepEqual(result.results[0].items.map((item) => item.id).sort(), ['d-54', 'd-55', 'd-56', 'd-57', 'd-58', 'd-59']);
});

test('temporary AP cannot replace the permanent 12 AP target', () => {
  const item = passiveItem({
    id: 'temporary-ap', passiveId: 'temp-ap',
    rules: [{ trigger: { type: 'turn_in', turns: [1, 2, 3] }, stats: { ap: 1 } }]
  });
  const output = optimizeBuild({
    items: [item], sets: [], selections,
    constraints: { ap: 12 }, fmPolicy,
    slotRules: [{ id: 'dofus', count: 1 }],
    character: { ...noPoints, baseStats: { ap: 11 } }, topN: 1
  });
  assert.equal(output.results.length, 0);
});

test('a T1-only AP passive cannot replace the permanent AP target', () => {
  const item = passiveItem({
    id: 't1-ap', passiveId: 't1-ap',
    rules: [{ trigger: { type: 'turn_in', turns: [1] }, stats: { ap: 2 } }]
  });
  const output = optimizeBuild({
    items: [item], sets: [], selections,
    constraints: { ap: 12 }, fmPolicy,
    slotRules: [{ id: 'dofus', count: 1 }],
    character: { ...noPoints, baseStats: { ap: 10 } }, turnMode: 't1', topN: 1
  });
  assert.equal(output.results.length, 0);
});

test('temporary AP overcap is allowed after a permanent 12 AP base and can fund a 15 AP turn', () => {
  const item = passiveItem({
    id: 't1-ap', passiveId: 't1-ap',
    rules: [{ trigger: { type: 'turn_in', turns: [1] }, stats: { ap: 3 } }]
  });
  const fifteenApSelections = [{ enabled: true, weight: 1, spell: { ...spell, apCost: 5 }, casts: { 1: 3 } }];
  const output = optimizeBuild({
    items: [item], sets: [], selections: fifteenApSelections,
    constraints: { ap: 12 }, fmPolicy,
    slotRules: [{ id: 'dofus', count: 1 }],
    character: { ...noPoints, baseStats: { ap: 12 } }, turnMode: 't1', topN: 1
  });
  assert.equal(output.results.length, 1);
  assert.equal(output.results[0].effectiveStatsByTurn[1].ap, 15);
});

test('temporary AP never bypasses a static equipment condition', () => {
  const item = passiveItem({
    id: 't1-ap', passiveId: 't1-ap',
    rules: [{ trigger: { type: 'turn_in', turns: [1] }, stats: { ap: 3 } }]
  });
  item.conditions = { kind: 'condition', stat: 'ap', operator: 'gte', value: 15 };
  const output = optimizeBuild({
    items: [item], sets: [], selections,
    constraints: { ap: 12 }, fmPolicy,
    slotRules: [{ id: 'dofus', count: 1 }],
    character: { ...noPoints, baseStats: { ap: 12 } }, turnMode: 't1', topN: 1
  });
  assert.equal(output.results.length, 0);
});

test('temporary MP cannot replace the permanent 6 MP target', () => {
  const item = passiveItem({
    id: 'temp-mp', passiveId: 'temp-mp',
    rules: [{ trigger: { type: 'turn_in', turns: [1, 2, 3] }, stats: { mp: 1 } }]
  });
  const output = optimizeBuild({
    items: [item], sets: [], selections,
    constraints: { mp: 6 }, fmPolicy,
    slotRules: [{ id: 'dofus', count: 1 }],
    character: { ...noPoints, baseStats: { mp: 5 } }, topN: 1
  });
  assert.equal(output.results.length, 0);
});

test('AP and MP targets reject permanent overcap builds', () => {
  const item = { id: 'overcap', name: 'overcap', slot: 'hat', stats: { mp: 1 } };
  const output = optimizeBuild({
    items: [item],
    sets: [],
    selections,
    constraints: { ap: 12, mp: 6 },
    fmPolicy,
    slotRules: [{ id: 'hat', count: 1 }],
    character: { ...noPoints, baseStats: { ap: 12, mp: 6 } },
    topN: 1
  });

  assert.equal(output.results.length, 0);
});

test('Pryximite melee bonus is ignored by spell scoring, even when its context is resolved', () => {
  const pryximite = passiveItem({
    id: 'pryximite',
    passiveId: 'pryximite',
    rules: [{
      trigger: { type: 'turn_in', turns: [1, 2, 3] },
      scaledStats: [
        { stat: 'meleeDamagePct', contextKey: 'pryximiteNearbyEnemiesStartT1', multiplier: 2, min: 0 },
        { stat: 'meleeDamagePct', contextKey: 'pryximiteNearbyEnemiesEndT1', multiplier: 2, min: 0 }
      ]
    }]
  });
  const powerDofus = { id: 'power-dofus', name: 'power-dofus', slot: 'dofus', stats: { power: 5 } };
  const testSpell = { id: 'spell', name: 'Spell', baseCritPct: 0, hits: [{ element: 'earth', normal: [100, 100] }] };
  const testSelections = [{ enabled: true, weight: 1, spell: testSpell, casts: { 1: 1 } }];
  const common = {
    items: [powerDofus, pryximite],
    sets: [],
    selections: testSelections,
    constraints: {},
    fmPolicy,
    slotRules: [{ id: 'dofus', count: 1 }],
    character: noPoints,
    turnMode: 't1',
    topN: 2
  };

  const resolved = optimizeBuild({
    ...common,
    scenario: { pryximiteNearbyEnemiesStartT1: 2, pryximiteNearbyEnemiesEndT1: 2 }
  });
  assert.equal(resolved.results[0].items[0].id, 'power-dofus');

  const unresolved = optimizeBuild(common);
  assert.equal(unresolved.results.some((result) => result.items[0].id === 'pryximite'), false);
  assert.ok(unresolved.diagnostics.rejectedUnresolvedPassives >= 1);
});