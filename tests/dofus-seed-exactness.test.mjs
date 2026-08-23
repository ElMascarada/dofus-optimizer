import test from 'node:test';
import assert from 'node:assert/strict';
import { optimizeBuild } from '../js/solver.js';

test('Dofus seed prior never forces a familiar core over a stronger exact result', () => {
  const items = [
    { id: 'neb', name: 'Dofus Nébuleux', slot: 'dofus', level: 200, stats: {} },
    { id: 'raw', name: 'Dofus expérimental brut', slot: 'dofus', level: 200, stats: { earth: 200 } }
  ];
  const spell = {
    id: 'earth-hit',
    name: 'Earth hit',
    baseCritPct: 0,
    distance: 'ranged',
    hits: [{ element: 'earth', normal: [100, 100], crit: [100, 100] }]
  };

  const output = optimizeBuild({
    items,
    sets: [],
    selections: [{ enabled: true, weight: 1, spell, casts: { 1: 1, 2: 1, 3: 1 } }],
    constraints: {},
    fmPolicy: { spellDamagePct: 0, allowCritDamage: false, critDamageAmount: 0 },
    turnMode: 'sum',
    slotRules: [{ id: 'dofus', count: 1 }],
    topN: 1
  });

  assert.equal(output.results.length, 1);
  assert.equal(output.results[0].items[0].id, 'raw');
});