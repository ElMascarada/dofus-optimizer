import test from 'node:test';
import assert from 'node:assert/strict';
import { optimizeBuild } from '../js/solver.js';

const spell = { id: 's', name: 'S', baseCritPct: 0, hits: [{ element: 'earth', normal: [10,10] }] };

test('solver respects a hard resistance constraint and ranks damage', () => {
  const items = [
    { id: 'h1', name: 'Damage', slot: 'hat', stats: { earth: 100 } },
    { id: 'h2', name: 'Res', slot: 'hat', stats: { earth: 20, resEarth: 40 } }
  ];
  const output = optimizeBuild({
    items,
    sets: [],
    selections: [{ enabled: true, weight: 1, spell, casts: {1:1,2:1,3:1} }],
    constraints: { resEarth: 40 },
    fmPolicy: { spellDamagePct: 3, allowCritDamage: false, critDamageAmount: 8 },
    slotRules: [{ id: 'hat', count: 1 }],
    character: { characteristicPoints: 0, scrolled: {}, baseStats: {} },
    topN: 5
  });
  assert.equal(output.results.length, 1);
  assert.equal(output.results[0].items[0].id, 'h2');
});
