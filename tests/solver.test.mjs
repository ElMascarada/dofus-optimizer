import test from 'node:test';
import assert from 'node:assert/strict';
import { optimizeBuild } from '../js/solver.js';

const spell = { id: 's', name: 'S', apCost: 2, baseCritPct: 0, hits: [{ element: 'earth', normal: [10, 10] }] };
const selections = [{ enabled: true, weight: 1, spell, casts: { 1: 1, 2: 0, 3: 0 } }];
const fmPolicy = { spellDamagePct: 0, allowCritDamage: false, critDamageAmount: 8, structuralExos: false };
const noPoints = { level: 200, characteristicPoints: 0, scrolled: {}, baseStats: {} };

function passiveItem({ id, passiveId, rules, stats = {} }) {
  return {
    id,
    name: id,
    slot: 'dofus',
    slotSubtype: 'prysmaradite',
    stats,
    passives: [{ id: passiveId, rules }],
    conditions: null
  };
}

// Core solver legality and passive-context tests.
test('rejects a build below hard AP requirements', () => {
  const output = optimizeBuild({
    items: [{ id: 'hat', name: 'hat', slot: 'hat', stats: {} }],
    sets: [],
    selections,
    constraints: { ap: 12 },
    fmPolicy,
    slotRules: [{ id: 'hat', count: 1 }],
    character: { ...noPoints, baseStats: { ap: 11 } },
    topN: 1
  });
  assert.equal(output.results.length, 0);
});

test('accepts a build meeting hard AP requirements', () => {
  const output = optimizeBuild({
    items: [{ id: 'hat', name: 'hat', slot: 'hat', stats: { ap: 1 } }],
    sets: [],
    selections,
    constraints: { ap: 12 },
    fmPolicy,
    slotRules: [{ id: 'hat', count: 1 }],
    character: { ...noPoints, baseStats: { ap: 11 } },
    topN: 1
  });
  assert.equal(output.results.length, 1);
});

test('temporary AP cannot replace the permanent target', () => {
  const item = passiveItem({
    id: 'temporary-ap',
    passiveId: 'temporary-ap',
    rules: [{ trigger: { type: 'turn_in', turns: [1] }, stats: { ap: 2 } }]
  });
  const output = optimizeBuild({
    items: [item],
    sets: [],
    selections,
    constraints: { ap: 12 },
    fmPolicy,
    slotRules: [{ id: 'dofus', count: 1 }],
    character: { ...noPoints, baseStats: { ap: 10 } },
    turnMode: 't1',
    topN: 1
  });
  assert.equal(output.results.length, 0);
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

test('AP and MP targets are minimums and preserve permanent overcap builds', () => {
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

  assert.equal(output.results.length, 1);
  assert.equal(output.results[0].stats.ap, 12);
  assert.equal(output.results[0].stats.mp, 7);
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
  const common = {
    items: [pryximite],
    sets: [],
    selections,
    constraints: {},
    fmPolicy,
    slotRules: [{ id: 'dofus', count: 1 }],
    character: { ...noPoints, baseStats: { ap: 12, mp: 6, earth: 100 } },
    turnMode: 't1',
    topN: 1
  };
  const output = optimizeBuild({
    ...common,
    scenario: { turns: { 1: { pryximiteNearbyEnemiesStartT1: 3, pryximiteNearbyEnemiesEndT1: 3 } } }
  });
  assert.equal(output.results.length, 1);
  assert.equal(output.results[0].effectiveStatsByTurn[1].meleeDamagePct, 12);
});
