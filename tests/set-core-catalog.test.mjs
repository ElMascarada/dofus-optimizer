import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSetCoreCatalog,
  evaluateSetCoreLegality,
  setCoresAreCompatible
} from '../optimizer/set-core-catalog.js';
import { createSetCoreAwareCandidatePolicy } from '../optimizer/set-core-candidate-policy.js';

function item(id, slot, setId, stats = {}, extra = {}) {
  return {
    id,
    name: id,
    level: 200,
    slot,
    setId,
    stats,
    passives: [],
    conditions: null,
    certified: true,
    ...extra
  };
}

function earthSelection() {
  return [{
    enabled: true,
    weight: 1,
    casts: { 1: 1, 2: 0, 3: 0 },
    spell: {
      id: 'earth-hit',
      apCost: 4,
      baseCritPct: 0,
      hits: [{ element: 'earth', normal: [40, 40] }]
    }
  }];
}

test('set core catalog includes the real 2-piece bonus in aggregate stats', () => {
  const items = [
    item('a', 'hat', 'set-a', { earth: 100 }),
    item('b', 'cape', 'set-a', { earth: 80 }),
    item('c', 'belt', 'set-a', { earth: 60 })
  ];
  const sets = [{ id: 'set-a', name: 'Set A', equipmentIds: items.map((entry) => entry.id), bonuses: { 2: { earth: 50 }, 3: { earth: 90 } } }];
  const catalog = buildSetCoreCatalog({ items, sets, pruneDominated: false });
  const core = catalog.cores.find((entry) => entry.pieceCount === 2 && entry.items.includes('a') && entry.items.includes('b'));
  assert.ok(core);
  assert.equal(core.itemStats.earth, 180);
  assert.equal(core.setBonuses.earth, 50);
  assert.equal(core.aggregateStats.earth, 230);
});

test('set core catalog includes the real 3-piece bonus in aggregate stats', () => {
  const items = [
    item('a', 'hat', 'set-a', { earth: 100 }),
    item('b', 'cape', 'set-a', { earth: 80 }),
    item('c', 'belt', 'set-a', { earth: 60 })
  ];
  const sets = [{ id: 'set-a', equipmentIds: items.map((entry) => entry.id), bonuses: { 2: { earth: 50 }, 3: { earth: 120, ap: 1 } } }];
  const catalog = buildSetCoreCatalog({ items, sets, pruneDominated: false });
  const core = catalog.cores.find((entry) => entry.pieceCount === 3);
  assert.ok(core);
  assert.equal(core.aggregateStats.earth, 360);
  assert.equal(core.aggregateStats.ap, 1);
});

test('slot-incompatible core is rejected', () => {
  const rings = [item('r1', 'ring', 'rings'), item('r2', 'ring', 'rings'), item('r3', 'ring', 'rings')];
  const legality = evaluateSetCoreLegality(rings);
  assert.equal(legality.valid, false);
  assert.ok(legality.reasons.includes('slot-overflow:ring'));
});

test('offensive core survives Candidate Policy even when members are individually weak', () => {
  const items = [
    item('set-hat', 'hat', 'burst', { earth: 20 }),
    item('set-cape', 'cape', 'burst', { earth: 20 }),
    item('plain-hat', 'hat', null, { earth: 160 }),
    item('plain-cape', 'cape', null, { earth: 160 })
  ];
  const sets = [{ id: 'burst', equipmentIds: ['set-hat', 'set-cape'], bonuses: { 2: { earth: 450 } } }];
  const policy = createSetCoreAwareCandidatePolicy({ items, sets, selections: earthSelection(), turnMode: 't1' });
  assert.ok(policy.setCoreHints.some((core) => core.items.includes('set-hat') && core.items.includes('set-cape')));
});

test('core useful to a hard constraint survives Candidate Policy', () => {
  const items = [
    item('init-hat', 'hat', 'swift', { earth: 1 }),
    item('init-cape', 'cape', 'swift', { earth: 1 }),
    item('plain-hat', 'hat', null, { earth: 200 }),
    item('plain-cape', 'cape', null, { earth: 200 })
  ];
  const sets = [{ id: 'swift', equipmentIds: ['init-hat', 'init-cape'], bonuses: { 2: { initiative: 2500 } } }];
  const policy = createSetCoreAwareCandidatePolicy({
    items,
    sets,
    selections: earthSelection(),
    constraints: { initiative: 2000 },
    turnMode: 't1'
  });
  assert.ok(policy.setCoreHints.some((core) => core.setId === 'swift' && core.policyConstraintSignal > 0));
});

test('truly dominated core is eliminated conservatively', () => {
  const items = [
    item('hat-strong', 'hat', 'set-a', { earth: 120, vit: 100 }),
    item('hat-weak', 'hat', 'set-a', { earth: 60, vit: 50 }),
    item('cape', 'cape', 'set-a', { earth: 80, vit: 100 })
  ];
  const sets = [{ id: 'set-a', equipmentIds: items.map((entry) => entry.id), bonuses: { 2: { earth: 40 } } }];
  const catalog = buildSetCoreCatalog({ items, sets });
  assert.equal(catalog.diagnostics.dominatedRemoved, 1);
  assert.ok(catalog.cores.some((core) => core.items.includes('hat-strong') && core.items.includes('cape')));
  assert.ok(!catalog.cores.some((core) => core.items.includes('hat-weak') && core.items.includes('cape')));
});

test('core compatibility exposes slot conflicts without combining cores', () => {
  const items = [
    item('a-hat', 'hat', 'a', { earth: 10 }), item('a-cape', 'cape', 'a', { earth: 10 }),
    item('b-hat', 'hat', 'b', { fire: 10 }), item('b-belt', 'belt', 'b', { fire: 10 })
  ];
  const sets = [
    { id: 'a', equipmentIds: ['a-hat', 'a-cape'], bonuses: { 2: { earth: 20 } } },
    { id: 'b', equipmentIds: ['b-hat', 'b-belt'], bonuses: { 2: { fire: 20 } } }
  ];
  const catalog = buildSetCoreCatalog({ items, sets, pruneDominated: false });
  const a = catalog.cores.find((core) => core.setId === 'a');
  const b = catalog.cores.find((core) => core.setId === 'b');
  const compatibility = setCoresAreCompatible(a, b, { items });
  assert.equal(compatibility.compatible, false);
  assert.ok(compatibility.reasons.includes('slot-overflow:hat'));
});
