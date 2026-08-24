import test from 'node:test';
import assert from 'node:assert/strict';
import { searchArchitecturesV2 } from '../js/architecture-search-v2.js';

const fireSpell = {
  id: 'fire-benchmark',
  name: 'Fire benchmark',
  apCost: 3,
  baseCritPct: 0,
  hits: [{ element: 'fire', normal: [30, 30], crit: [30, 30] }]
};

const selections = [{
  enabled: true,
  weight: 1,
  spell: fireSpell,
  casts: { 1: 1, 2: 0, 3: 0 }
}];

function item(id, slot, stats = {}, setId = null, typeName = slot, level = 200) {
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
    typeName
  };
}

test('a set AP bonus frees Dofus slots for offense instead of stacking useless AP/MP trophies', () => {
  const items = [
    item('set-hat', 'hat', { fire: 120 }, 'set-a'),
    item('set-cape', 'cape', { fire: 110 }, 'set-a'),
    item('set-belt', 'belt', { fire: 100 }, 'set-a'),
    item('amulet', 'amulet', { fire: 80, ap: 1 }),
    item('ring-a', 'ring', { fire: 100 }),
    item('ring-b', 'ring', { fire: 90 }),
    item('boots', 'boots', { fire: 80, mp: 1 }),
    item('weapon', 'weapon', { fire: 120, ap: 1 }),
    item('shield', 'shield', { fire: 70, ap: 1 }),
    item('companion', 'companion', { fire: 100, mp: 1 }, null, 'Familier', 200),
    ...Array.from({ length: 6 }, (_, index) => item(`off-${index + 1}`, 'dofus', { power: 100 }, null, 'Dofus')),
    ...Array.from({ length: 6 }, (_, index) => item(`ap-${index + 1}`, 'dofus', { ap: 1 }, null, 'Trophée')),
    ...Array.from({ length: 6 }, (_, index) => item(`mp-${index + 1}`, 'dofus', { mp: 1 }, null, 'Trophée'))
  ];

  const sets = [{
    id: 'set-a',
    name: 'Set A',
    bonuses: {
      '2': { fire: 40 },
      '3': { fire: 80, ap: 1 }
    },
    equipmentIds: ['set-hat', 'set-cape', 'set-belt']
  }];

  const output = searchArchitecturesV2({
    items,
    sets,
    selections,
    constraints: { ap: 12, mp: 6, range: 0, vit: 0, resEarth: 0, resFire: 0, resWater: 0, resAir: 0 },
    fmPolicy: { spellDamagePct: 0, allowCritDamage: false, critDamageAmount: 8, structuralExos: false },
    turnMode: 't1',
    scenario: { requiredApByTurn: {} },
    topN: 3
  });

  assert.ok(output.results.length > 0);
  const bestIds = new Set(output.results[0].items.map((entry) => entry.id));
  for (let index = 1; index <= 6; index++) assert.ok(bestIds.has(`off-${index}`));
  assert.ok(![...bestIds].some((id) => id.startsWith('ap-') || id.startsWith('mp-')));
  assert.equal(output.results[0].stats.ap, 12);
  assert.equal(output.results[0].stats.mp, 6);
});
