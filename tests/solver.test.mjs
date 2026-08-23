import test from 'node:test';
import assert from 'node:assert/strict';
import { optimizeBuild } from '../js/solver.js';

const spell = { id: 's', name: 'S', baseCritPct: 0, hits: [{ element: 'earth', normal: [10, 10] }] };
const selections = [{ enabled: true, weight: 1, spell, casts: { 1: 1, 2: 1, 3: 1 } }];
const fmPolicy = { spellDamagePct: 3, allowCritDamage: false, critDamageAmount: 8 };
const noPoints = { level: 200, characteristicPoints: 0, scrolled: {}, baseStats: {} };

function passiveItem({ id, passiveId, rules, stats = {}, conditions = null }) {
  return {
    id,
    name: id,
    slot: 'dofus',
    slotSubtype: 'prysmaradite',
    stats,
    conditions,
    passives: [{ id: passiveId, rules }]
  };
}

test('solver respects a hard resistance constraint and ranks damage', () => {
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

test('huge six-Dofus combination space is not materialized and dominance keeps the exact optimum', () => {
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
  assert.equal(group.materializedChoices, 0);
  assert.equal(group.candidates, 6);
});

test('temporary AP cannot replace the permanent 12 AP target', () => {
  const pryssion = passiveItem({
    id: 'pryssion',
    passiveId: 'pryssion-matte',
    rules: [{ trigger: { type: 'turn_in', turns: [1, 2, 3] }, stats: { ap: 1, finalDamagePct: -10 } }]
  });
  const output = optimizeBuild({
    items: [pryssion],
    sets: [],
    selections,
    constraints: { ap: 12 },
    fmPolicy,
    slotRules: [{ id: 'dofus', count: 1 }],
    character: { ...noPoints, baseStats: { ap: 11 } },
    turnMode: 'sum',
    topN: 5
  });

  assert.equal(output.results.length, 0);
});

test('a T1-only AP passive cannot replace the permanent AP target', () => {
  const prycipithon = passiveItem({
    id: 'prycipithon',
    passiveId: 'prycipithon-matte',
    rules: [{ trigger: { type: 'turn_in', turns: [1] }, stats: { ap: 2 } }]
  });
  const common = {
    items: [prycipithon],
    sets: [],
    selections,
    constraints: { ap: 12 },
    fmPolicy,
    slotRules: [{ id: 'dofus', count: 1 }],
    character: { ...noPoints, baseStats: { ap: 10 } },
    topN: 1
  };

  const t1 = optimizeBuild({ ...common, turnMode: 't1' });
  const sum = optimizeBuild({ ...common, turnMode: 'sum' });
  assert.equal(t1.results.length, 0);
  assert.equal(sum.results.length, 0);
});

test('temporary AP never bypasses a static equipment condition', () => {
  const conditioned = passiveItem({
    id: 'conditioned-pryssion',
    passiveId: 'pryssion-matte',
    conditions: { kind: 'condition', stat: 'ap', operator: 'gte', value: 12 },
    rules: [{ trigger: { type: 'turn_in', turns: [1, 2, 3] }, stats: { ap: 1, finalDamagePct: -10 } }]
  });
  const output = optimizeBuild({
    items: [conditioned],
    sets: [],
    selections,
    constraints: { ap: 12 },
    fmPolicy,
    slotRules: [{ id: 'dofus', count: 1 }],
    character: { ...noPoints, baseStats: { ap: 11 } },
    turnMode: 'sum',
    topN: 1
  });

  assert.equal(output.results.length, 0);
  assert.equal(output.diagnostics.rejectedConditions, 1);
});

test('temporary MP cannot replace the permanent 6 MP target', () => {
  const ratrapry = passiveItem({
    id: 'ratrapry',
    passiveId: 'ratrapry',
    rules: [{
      trigger: { type: 'turn_in', turns: [1, 2, 3] },
      scaledStats: [{ stat: 'mp', contextKey: 'farEnemiesOver9', multiplier: 1, min: 0, max: 3 }]
    }]
  });
  const common = {
    items: [ratrapry],
    sets: [],
    selections,
    constraints: { mp: 6 },
    fmPolicy,
    slotRules: [{ id: 'dofus', count: 1 }],
    character: { ...noPoints, baseStats: { mp: 4 } },
    turnMode: 't1',
    topN: 1
  };

  const resolved = optimizeBuild({ ...common, scenario: { turns: { 1: { farEnemiesOver9: 2 } } } });
  const unresolved = optimizeBuild(common);
  assert.equal(resolved.results.length, 0);
  assert.equal(unresolved.results.length, 0);
  assert.equal(unresolved.diagnostics.rejectedUnresolvedPassives, 1);
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

test('Pryximite is scored offensively only when its T1 proximity context is provided', () => {
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
  const meleeSpell = { id: 'melee', name: 'Melee', baseCritPct: 0, distance: 'melee', hits: [{ element: 'earth', normal: [100, 100] }] };
  const meleeSelections = [{ enabled: true, weight: 1, spell: meleeSpell, casts: { 1: 1 } }];
  const common = {
    items: [powerDofus, pryximite],
    sets: [],
    selections: meleeSelections,
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
  assert.equal(resolved.results[0].items[0].id, 'pryximite');
  assert.equal(resolved.results[0].effectiveStatsByTurn[1].meleeDamagePct, 8);

  const unresolved = optimizeBuild(common);
  assert.equal(unresolved.results.some((result) => result.items[0].id === 'pryximite'), false);
  assert.ok(unresolved.diagnostics.rejectedUnresolvedPassives >= 1);
});
