import test from 'node:test';
import assert from 'node:assert/strict';
import { optimizeCombatSequence } from '../js/turn-optimizer.js';

function damageSpell({ id, name = id, apCost = 4, base = 30, maxCastPerTurn = 3, isArea = false, distanceOptions = ['melee', 'ranged'], modifiers = [], element = 'air', breedId = null, breedName = null } = {}) {
  return {
    id,
    name,
    apCost,
    baseCritPct: 0,
    maxCastPerTurn,
    maxCastPerTarget: maxCastPerTurn,
    isArea,
    distanceOptions,
    breedId,
    breedName,
    hits: [{ element, normal: [base, base], crit: [base, base] }],
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

test('spell, melee and final damage bonuses multiply instead of adding', () => {
  const melee = damageSpell({ id: 'melee', apCost: 5, base: 100, maxCastPerTurn: 1, distanceOptions: ['melee'] });
  const result = optimizeCombatSequence({
    baseStats: {
      ap: 5,
      air: 0,
      spellDamagePct: 10,
      meleeDamagePct: 20,
      rangedDamagePct: 200,
      finalDamagePct: 30
    },
    spells: [melee],
    objective: { turns: 1 }
  });

  assert.equal(Math.round(result.totalDamage * 10) / 10, 171.6);
  assert.equal(result.sequence[0].distance, 'melee');
});

test('a flexible spell uses the stronger legal distance multiplier', () => {
  const flexible = damageSpell({ id: 'flex', apCost: 4, base: 100, maxCastPerTurn: 1, distanceOptions: ['melee', 'ranged'] });
  const result = optimizeCombatSequence({
    baseStats: { ap: 4, air: 0, meleeDamagePct: 10, rangedDamagePct: 40 },
    spells: [flexible],
    objective: { turns: 1 }
  });

  assert.equal(Math.round(result.totalDamage), 140);
  assert.equal(result.sequence[0].distance, 'ranged');
});

test('Huppermage conditional four-element spells resolve one damage line, not four', () => {
  const conditional = {
    id: 'spell-13672',
    name: 'Drain Élémentaire',
    breedId: 17,
    breedName: 'Huppermage',
    apCost: 2,
    baseCritPct: 0,
    maxCastPerTurn: 1,
    maxCastPerTarget: 1,
    distanceOptions: ['melee', 'ranged'],
    hits: ['earth', 'fire', 'water', 'air'].map((element) => ({ element, normal: [20, 20], crit: [20, 20] })),
    combatModifiers: [],
    combatRelevant: true
  };

  const result = optimizeCombatSequence({
    baseStats: { ap: 2 },
    spells: [conditional],
    objective: { turns: 1 }
  });

  assert.equal(Math.round(result.totalDamage), 20);
  assert.equal(result.sequence.length, 1);
  assert.ok(['earth', 'fire', 'water', 'air'].includes(result.sequence[0].element));
});

test('Huppermage earth-fire combination applies +15% damage taken to following casts', () => {
  const earth = damageSpell({ id: 'earth', apCost: 2, base: 10, maxCastPerTurn: 1, element: 'earth', breedId: 17, breedName: 'Huppermage' });
  const fire = damageSpell({ id: 'fire', apCost: 2, base: 10, maxCastPerTurn: 1, element: 'fire', breedId: 17, breedName: 'Huppermage' });
  const finisher = damageSpell({ id: 'finisher', apCost: 2, base: 100, maxCastPerTurn: 1, element: 'air', breedId: 17, breedName: 'Huppermage' });

  const result = optimizeCombatSequence({
    baseStats: { ap: 6 },
    spells: [finisher, fire, earth],
    objective: { turns: 1 },
    beamWidth: 500
  });

  assert.equal(result.sequence[2].spellId, 'finisher');
  assert.equal(Math.round(result.sequence[2].targetDamageMultiplier * 100) / 100, 1.15);
  assert.equal(Math.round(result.totalDamage), 135);
});

test('extra static crit has zero marginal damage once a support effect already reaches 100% crit', () => {
  const surpriz = supportSpell({
    id: 'surpriz',
    apCost: 1,
    modifiers: [{ id: 'guaranteed-crit', scope: 'self', stats: { crit: 100 }, durationTurns: 1 }]
  });
  const hit = damageSpell({ id: 'crit-hit', apCost: 5, base: 100, maxCastPerTurn: 1 });
  hit.hits = [{ element: 'air', normal: [100, 100], crit: [200, 200] }];

  const withoutTurquoise = optimizeCombatSequence({
    baseStats: { ap: 6, crit: 0 },
    spells: [hit, surpriz],
    objective: { turns: 1, allowSupport: true }
  });
  const withTurquoise = optimizeCombatSequence({
    baseStats: { ap: 6, crit: 10 },
    spells: [hit, surpriz],
    objective: { turns: 1, allowSupport: true }
  });

  assert.deepEqual(withoutTurquoise.sequence.map((entry) => entry.spellId), ['surpriz', 'crit-hit']);
  assert.equal(withTurquoise.totalDamage, withoutTurquoise.totalDamage);
});
