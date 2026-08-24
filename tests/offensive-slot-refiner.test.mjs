import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCompleteBuild } from '../js/complete-build-evaluator.js';
import { refineOffensiveSlots } from '../js/offensive-slot-refiner.js';

const spell = {
  id: 'air-benchmark',
  name: 'Air benchmark',
  apCost: 3,
  baseCritPct: 0,
  hits: [{ element: 'air', normal: [100, 100], crit: [300, 300] }]
};
const selections = [{ enabled: true, weight: 1, spell, casts: { 1: 1, 2: 0, 3: 0 } }];
const constraints = { ap: 12, mp: 6, range: 0, vit: 0, resEarth: 0, resFire: 0, resWater: 0, resAir: 0 };
const fmPolicy = { spellDamagePct: 0, allowCritDamage: true, critDamageAmount: 8, structuralExos: false };

function item(id, slot, stats = {}, extra = {}) {
  return {
    id,
    name: id,
    level: 200,
    slot,
    setId: null,
    stats,
    passives: [],
    conditions: null,
    slotSubtype: null,
    typeName: slot,
    ...extra
  };
}

const skeleton = [
  item('hat', 'hat', { ap: 1, air: 80 }),
  item('cape', 'cape', { ap: 1, air: 80 }),
  item('amulet', 'amulet', { ap: 1, air: 80 }),
  item('ring-a', 'ring', { air: 80 }),
  item('ring-b', 'ring', { air: 80 }),
  item('belt', 'belt', { air: 80 }),
  item('boots', 'boots', { mp: 2, air: 80 }),
  item('weapon', 'weapon', { air: 80 }),
  item('shield', 'shield', { air: 80 })
];

const statPet = item('stat-pet', 'companion', { ap: 1, air: 100 });
const critPet = item('crit-pet', 'companion', { crit: 40 });
const weakDofus = Array.from({ length: 6 }, (_, index) => item(`weak-${index}`, 'dofus', { air: 10 }));
const ocre = item('ocre', 'dofus', { ap: 1 }, { typeName: 'Dofus' });
const pourpre = item('pourpre', 'dofus', { power: 80 }, { typeName: 'Dofus' });
const strongPower = Array.from({ length: 4 }, (_, index) => item(`power-${index}`, 'dofus', { power: 70 }));
const air50 = item('air-50', 'dofus', { air: 50 });
const cawotte = item('cawotte', 'dofus', { wisdom: 60 }, { typeName: 'Dofus' });

function evaluate(items) {
  return evaluateCompleteBuild({
    items,
    sets: [],
    selections,
    constraints,
    fmPolicy,
    turnMode: 't1',
    scenario: { requiredApByTurn: {} }
  }).result;
}

test('refiner compares companion + Dofus together with real expected crit damage', () => {
  // Seed the build with a deliberately useless real Dofus to ensure current
  // equipment does not get privileged over a strictly better offensive option.
  const source = evaluate([...skeleton, statPet, ...weakDofus.slice(0, 5), cawotte]);
  assert.ok(source);

  const output = refineOffensiveSlots({
    results: [source],
    items: [...skeleton, statPet, critPet, ...weakDofus, ocre, pourpre, ...strongPower, air50, cawotte],
    sets: [],
    selections,
    constraints,
    fmPolicy,
    turnMode: 't1',
    scenario: { requiredApByTurn: {} },
    topN: 3
  });

  assert.ok(output.results.length > 0);
  const bestIds = new Set(output.results[0].items.map((entry) => entry.id));
  assert.ok(bestIds.has('crit-pet'), 'crit pet should win on expected damage');
  assert.ok(bestIds.has('ocre'), 'AP should be supplied by the Dofus slot when the crit pet wins');
  assert.ok(bestIds.has('pourpre'), '80 power should be valued as 80 elemental stats');
  assert.ok(!bestIds.has('air-50'), '50 air should lose to stronger power choices when slots are limited');
  assert.ok(!bestIds.has('cawotte'), 'zero-impact Dofus should not survive offensive refinement');
  assert.equal(output.results[0].stats.ap, 12);
  assert.equal(output.results[0].stats.mp, 6);
});
