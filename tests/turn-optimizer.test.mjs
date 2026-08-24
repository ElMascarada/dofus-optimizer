import test from 'node:test';
import assert from 'node:assert/strict';
import { optimizeCombatSequence } from '../js/turn-optimizer.js';

function damageSpell({ id, name = id, apCost = 4, base = 30, maxCastPerTurn = 3, isArea = false, distanceOptions = ['melee', 'ranged'], modifiers = [] } = {}) {
  return {
    id,
    name,
    apCost,
    baseCritPct: 0,
    maxCastPerTurn,
    maxCastPerTarget: maxCastPerTurn,
    isArea,
    distanceOptions,
    hits: [{ element: 'air', normal: [base, base], crit: [base, base] }],
    combatModifiers: modifiers,
    combatRelevant: true
  };
}

function supportSpell({ id, name = id, apCost = 2, modifiers = [], maxCastPerTurn = 1 } = {}) {
  return {
    id,
    name,
    apCost,
    baseCritPct: 0,
    maxCastPerTurn,
    maxCastPerTarget: maxCastPerTurn,
    hits: [],
    combatModifiers: modifiers,
    combatRelevant: true,
    supportOnly: true
  };
}

test('spends AP on a power buff when it increases the remaining turn damage', () => {
  const hit = damageSpell({ id: 'hit', apCost: 5, base: 40, maxCastPerTurn: 2 });
  const power = supportSpell({
    id: 'power',
    apCost: 2,
    modifiers: [{ id: 'power-buff', scope: 'self', stats: { power: 200 }, durationTurns: 2 }]
  });

  const result = optimizeCombatSequence({
    baseStats: { ap: 12, air: 100 },
    spells: [hit, power],
    objective: { turns: 1, allowSupport: true }
  });

  assert.deepEqual(result.sequence.map((entry) => entry.spellId), ['power', 'hit', 'hit']);
  assert.ok(result.totalDamage > 240, `expected buffed sequence to exceed 240 damage, got ${result.totalDamage}`);
});

test('target vulnerability is worth casting before attacks when total damage increases', () => {
  const hit = damageSpell({ id: 'hit', apCost: 4, base: 50, maxCastPerTurn: 3 });
  const vulnerability = supportSpell({
    id: 'vulnerability',
    apCost: 2,
    modifiers: [{ id: 'vuln', scope: 'target', stats: { finalDamageTakenPct: 20 }, durationTurns: 2 }]
  });

  const result = optimizeCombatSequence({
    baseStats: { ap: 10, air: 100 },
    spells: [hit, vulnerability],
    objective: { turns: 1, allowSupport: true }
  });

  assert.deepEqual(result.sequence.map((entry) => entry.spellId), ['vulnerability', 'hit', 'hit']);
  assert.equal(Math.round(result.totalDamage), 240);
});

test('a duration-two self buff survives into the next turn', () => {
  const hit = damageSpell({ id: 'hit', apCost: 4, base: 30, maxCastPerTurn: 2 });
  const power = supportSpell({
    id: 'power',
    apCost: 2,
    modifiers: [{ id: 'power-buff', scope: 'self', stats: { power: 200 }, durationTurns: 2 }]
  });

  const result = optimizeCombatSequence({
    baseStats: { ap: 10, air: 100 },
    spells: [hit, power],
    objective: { turns: 2, allowSupport: true }
  });

  assert.equal(result.sequence.filter((entry) => entry.spellId === 'power').length, 1);
  assert.ok(result.perTurn[2] > 120, `expected T2 to retain the buff, got ${result.perTurn[2]}`);
});

test('turn-specific base stats change the optimal T1/T2 damage like a temporal Dofus', () => {
  const hit = damageSpell({ id: 'hit', apCost: 4, base: 40, maxCastPerTurn: 2 });
  const result = optimizeCombatSequence({
    baseStats: { ap: 8, air: 100 },
    baseStatsByTurn: {
      1: { ap: 8, air: 100, finalDamagePct: 20 },
      2: { ap: 8, air: 100, finalDamagePct: -10 },
      3: { ap: 8, air: 100 }
    },
    spells: [hit],
    objective: { turns: 2 }
  });

  assert.ok(result.perTurn[1] > result.perTurn[2], `expected T1 > T2, got ${result.perTurn[1]} vs ${result.perTurn[2]}`);
});

test('zone objective multiplies only area spell damage by the target count', () => {
  const area = damageSpell({ id: 'area', apCost: 4, base: 35, maxCastPerTurn: 2, isArea: true });
  const single = damageSpell({ id: 'single', apCost: 4, base: 60, maxCastPerTurn: 2, isArea: false });
  const result = optimizeCombatSequence({
    baseStats: { ap: 8, air: 100 },
    spells: [area, single],
    objective: { turns: 1, targetMode: 'zone', areaTargets: 3 }
  });

  assert.deepEqual(result.sequence.map((entry) => entry.spellId), ['area', 'area']);
});

test('support spells are ignored when allowSupport is disabled', () => {
  const hit = damageSpell({ id: 'hit', apCost: 5, base: 40, maxCastPerTurn: 2 });
  const power = supportSpell({
    id: 'power',
    apCost: 2,
    modifiers: [{ id: 'power-buff', scope: 'self', stats: { power: 300 }, durationTurns: 2 }]
  });

  const result = optimizeCombatSequence({
    baseStats: { ap: 12, air: 100 },
    spells: [hit, power],
    objective: { turns: 1, allowSupport: false }
  });

  assert.deepEqual(result.sequence.map((entry) => entry.spellId), ['hit', 'hit']);
});

test('stacks Psychopath Mask, Inferno and Furia style buffs when that is the best 12 AP turn', () => {
  const psychopath = supportSpell({
    id: 'psychopath-mask',
    apCost: 1,
    modifiers: [{ id: 'melee-buff', scope: 'self', stats: { meleeDamagePct: 10 }, durationTurns: 2 }]
  });
  const inferno = damageSpell({
    id: 'inferno',
    apCost: 4,
    base: 25,
    maxCastPerTurn: 1,
    distanceOptions: ['melee'],
    modifiers: [{ id: 'power-buff', scope: 'self', stats: { power: 200 }, durationTurns: 2 }]
  });
  const furia = damageSpell({
    id: 'furia',
    apCost: 3,
    base: 25,
    maxCastPerTurn: 1,
    distanceOptions: ['melee'],
    modifiers: [{ id: 'flat-buff', scope: 'self', stats: { damage: 40 }, durationTurns: 2 }]
  });
  const finisher = damageSpell({
    id: 'finisher',
    apCost: 4,
    base: 100,
    maxCastPerTurn: 1,
    distanceOptions: ['melee']
  });

  const result = optimizeCombatSequence({
    baseStats: { ap: 12, air: 0 },
    spells: [finisher, furia, inferno, psychopath],
    objective: { turns: 1, allowSupport: true },
    beamWidth: 2000
  });

  assert.deepEqual(result.sequence.map((entry) => entry.spellId), [
    'psychopath-mask',
    'inferno',
    'furia',
    'finisher'
  ]);
  assert.ok(result.totalDamage > 450, `expected stacked class buffs to be profitable, got ${result.totalDamage}`);
});

test('temporary melee damage only boosts spells that can be cast in melee', () => {
  const mask = supportSpell({
    id: 'mask',
    apCost: 1,
    modifiers: [{ id: 'melee', scope: 'self', stats: { meleeDamagePct: 50 }, durationTurns: 1 }]
  });
  const melee = damageSpell({ id: 'melee', apCost: 5, base: 100, maxCastPerTurn: 1, distanceOptions: ['melee'] });
  const ranged = damageSpell({ id: 'ranged', apCost: 5, base: 100, maxCastPerTurn: 1, distanceOptions: ['ranged'] });

  const result = optimizeCombatSequence({
    baseStats: { ap: 6, air: 0 },
    spells: [ranged, melee, mask],
    objective: { turns: 1, allowSupport: true }
  });

  assert.deepEqual(result.sequence.map((entry) => entry.spellId), ['mask', 'melee']);
  assert.equal(Math.round(result.totalDamage), 150);
});
