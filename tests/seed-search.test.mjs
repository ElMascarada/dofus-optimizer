import assert from 'node:assert/strict';
import test from 'node:test';
import { findSeedResults } from '../js/seed-search.js';
import { addStats, emptyStats } from '../js/stats.js';
import { applySetBonuses } from '../js/sets.js';

function choice(item) {
  return { items: [item] };
}

function exactEvaluator({ baseStats = {}, setsById = {}, constraints = {} } = {}) {
  return (items) => {
    const stats = emptyStats();
    addStats(stats, baseStats);
    for (const item of items) addStats(stats, item.stats || {});
    applySetBonuses(stats, items, setsById);
    for (const [key, minimum] of Object.entries(constraints)) {
      if (Number(stats[key] || 0) < Number(minimum || 0)) return null;
    }
    return {
      score: Number(stats.earth || 0) + Number(stats.power || 0),
      items,
      stats
    };
  };
}

const spell = {
  id: 'seed-earth',
  distance: 'ranged',
  baseCritPct: 0,
  hits: [{ element: 'earth', normal: [100, 100], crit: [100, 100] }]
};
const selections = [{ enabled: true, weight: 1, spell, casts: { 1: 1, 2: 1, 3: 1 } }];

test('seed search finds a legal constrained incumbent instead of keeping only the highest raw damage path', () => {
  const damageHat = { id: 'damage-hat', slot: 'hat', stats: { earth: 200 } };
  const resistHat = { id: 'res-hat', slot: 'hat', stats: { earth: 80, resEarth: 25 } };
  const damageCape = { id: 'damage-cape', slot: 'cape', stats: { earth: 180 } };
  const resistCape = { id: 'res-cape', slot: 'cape', stats: { earth: 60, resEarth: 20 } };
  const dofusDamage = { id: 'damage-dofus', slot: 'dofus', stats: { earth: 100 } };
  const dofusResist = { id: 'res-dofus', slot: 'dofus', stats: { resEarth: 20 } };
  const groups = [
    { id: 'hat', count: 1, dynamic: false, choices: [choice(damageHat), choice(resistHat)] },
    { id: 'cape', count: 1, dynamic: false, choices: [choice(damageCape), choice(resistCape)] },
    { id: 'dofus', count: 1, dynamic: true, candidates: [dofusDamage, dofusResist] }
  ];
  const constraints = { resEarth: 40 };
  const output = findSeedResults({
    groups,
    constraints,
    selections,
    turnMode: 'sum',
    evaluateComplete: exactEvaluator({ constraints }),
    resultLimit: 1,
    beamWidth: 16,
    dynamicBeamWidth: 32,
    dynamicBaseWidth: 16
  });
  assert.equal(output.results.length, 1);
  assert.ok(output.results[0].stats.resEarth >= 40);
  assert.ok(output.diagnostics.generated > 0);
});

test('seed ranking sees activated set bonuses so an individually weak piece can help form the incumbent', () => {
  const setsById = {
    volk: { id: 'volk', bonuses: { 2: { power: 250 } } }
  };
  const weakHat = { id: 'weak-hat', slot: 'hat', setId: 'volk', stats: { water: 50 } };
  const strongHat = { id: 'strong-hat', slot: 'hat', stats: { earth: 100 } };
  const setCape = { id: 'set-cape', slot: 'cape', setId: 'volk', stats: { earth: 20 } };
  const plainCape = { id: 'plain-cape', slot: 'cape', stats: { earth: 90 } };
  const groups = [
    { id: 'hat', count: 1, dynamic: false, choices: [choice(strongHat), choice(weakHat)] },
    { id: 'cape', count: 1, dynamic: false, choices: [choice(plainCape), choice(setCape)] }
  ];
  const output = findSeedResults({
    groups,
    setsById,
    selections,
    turnMode: 'sum',
    evaluateComplete: exactEvaluator({ setsById }),
    resultLimit: 1,
    beamWidth: 16
  });
  const ids = output.results[0].items.map((item) => item.id);
  assert.ok(ids.includes('weak-hat'));
  assert.ok(ids.includes('set-cape'));
  assert.equal(output.results[0].score, 270);
});
