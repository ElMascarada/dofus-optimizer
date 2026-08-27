import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSetSynergyIndex } from '../js/set-synergy-index.js';

const fireSpell = {
  id: 'fire-hit',
  apCost: 3,
  baseCritPct: 0,
  hits: [{ element: 'fire', normal: [20, 20] }]
};
const selections = [{ enabled: true, weight: 1, spell: fireSpell, casts: { 1: 1, 2: 0, 3: 0 } }];

function item(id, slot, setId, stats = {}) {
  return { id, name: id, level: 200, slot, setId, stats, passives: [] };
}

test('synergy index keeps full and 2-piece tiers without expanding multi-core architectures yet', () => {
  const items = [
    item('war-hat', 'hat', 'war', { fire: 100 }),
    item('war-cape', 'cape', 'war', { fire: 100 }),
    item('war-amulet', 'amulet', 'war', { fire: 100, ap: 1 }),
    item('war-belt', 'belt', 'war', { fire: 100 }),
    item('ember-boots', 'boots', 'ember', { fire: 90, mp: 1 }),
    item('ember-ring', 'ring', 'ember', { fire: 90 }),
    item('ember-weapon', 'weapon', 'ember', { fire: 90, ap: 1 }),
    item('spark-shield', 'shield', 'spark', { fire: 80 }),
    item('spark-ring', 'ring', 'spark', { fire: 80 })
  ];
  const sets = [
    { id: 'war', name: 'Guerre', bonuses: { '2': { fire: 80 }, '3': { fire: 120 }, '4': { fire: 160, ap: 1 } } },
    { id: 'ember', name: 'Braise', bonuses: { '2': { fire: 70 }, '3': { fire: 120 } } },
    { id: 'spark', name: 'Étincelle', bonuses: { '2': { fire: 90 } } }
  ];

  const index = buildSetSynergyIndex({ items, sets, selections, constraints: { ap: 12, mp: 6 }, turnMode: 't1' });
  assert.equal(index.targetElement, 'fire');
  assert.ok(index.plans.some((plan) => plan.setId === 'war' && plan.targetCount === 4));
  assert.ok(index.plans.some((plan) => plan.setId === 'war' && plan.targetCount === 2));
  assert.ok(index.architectures.length > 0);
  assert.ok(index.architectures.every((architecture) => architecture.plans.length === 1));
  assert.equal(index.diagnostics.combinedCoreArchitectures, false);
  assert.equal(index.diagnostics.compatibilityAvailable, true);
});
