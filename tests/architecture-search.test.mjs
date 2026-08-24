import test from 'node:test';
import assert from 'node:assert/strict';
import { searchArchitectures } from '../js/architecture-search.js';

const fireSpell = {
  id: 'fire-hit',
  name: 'Fire Hit',
  apCost: 3,
  baseCritPct: 0,
  hits: [{ element: 'fire', normal: [20, 20] }]
};

const selections = [{
  enabled: true,
  weight: 1,
  spell: fireSpell,
  casts: { 1: 1, 2: 0, 3: 0 }
}];

function item(id, slot, stats = {}, setId = null, level = 200) {
  return {
    id,
    name: id,
    level,
    slot,
    setId,
    stats,
    passives: [],
    conditions: null,
    slotSubtype: null,
    typeName: slot
  };
}

test('architecture search starts from a strong set and can replace a set piece with a stronger standalone', () => {
  const items = [
    item('war-hat', 'hat', { fire: 100 }, 'war'),
    item('war-cape', 'cape', { fire: 100 }, 'war'),
    item('war-amulet', 'amulet', { fire: 100, ap: 1 }, 'war'),
    item('war-belt', 'belt', { fire: 100 }, 'war'),
    item('legendary-hat', 'hat', { fire: 600, ap: 1 }),
    item('ring-a', 'ring', { fire: 120 }),
    item('ring-b', 'ring', { fire: 110 }),
    item('boots', 'boots', { fire: 80, mp: 1 }),
    item('weapon', 'weapon', { fire: 130, ap: 1 }),
    item('shield', 'shield', { fire: 70, ap: 1 }),
    item('pet', 'companion', { fire: 120, mp: 1 }, null, 20),
    item('d1', 'dofus', { fire: 60 }, null, 200),
    item('d2', 'dofus', { fire: 55 }, null, 200),
    item('d3', 'dofus', { power: 50 }, null, 200),
    item('d4', 'dofus', { damageFire: 20 }, null, 200),
    item('d5', 'dofus', { crit: 10 }, null, 200),
    item('d6', 'dofus', { damage: 15 }, null, 200)
  ];

  const sets = [{
    id: 'war',
    name: 'Guerre',
    bonuses: {
      '2': { fire: 80 },
      '3': { fire: 120 },
      '4': { fire: 160, ap: 1 }
    }
  }];

  const output = searchArchitectures({
    items,
    sets,
    selections,
    constraints: { ap: 12, mp: 6, range: 0, vit: 0, resEarth: 0, resFire: 0, resWater: 0, resAir: 0 },
    fmPolicy: { spellDamagePct: 3, allowCritDamage: true, critDamageAmount: 8, structuralExos: false },
    turnMode: 't1',
    scenario: { requiredApByTurn: { 1: 3 } },
    topN: 10
  });

  assert.ok(output.results.length > 0);
  assert.ok(output.diagnostics.evaluated < 5000);
  assert.ok(output.results[0].items.some((entry) => entry.id === 'legendary-hat'));
  assert.equal(output.results[0].stats.ap, 12);
  assert.equal(output.results[0].stats.mp, 6);
});
