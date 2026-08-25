import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCuratedSpellRules } from '../js/curated-runtime-rules.js';
import { optimizeCombatSequence } from '../js/turn-optimizer.js';

function damageSpell({ id = 'hit', apCost = 4, base = 50, maxCastPerTurn = 2, maxCastPerTarget = maxCastPerTurn } = {}) {
  return {
    id,
    name: id,
    apCost,
    baseCritPct: 0,
    maxCastPerTurn,
    maxCastPerTarget,
    hits: [{ element: 'earth', normal: [base, base], crit: [base, base] }],
    combatModifiers: [],
    combatRelevant: true
  };
}

test('Iop Accumulation can self-cast to charge later casts instead of being treated as direct damage only', () => {
  const accumulation = applyCuratedSpellRules({
    id: 'spell-13138',
    ankamaId: 13138,
    name: 'Accumulation',
    apCost: 3,
    baseCritPct: 10,
    maxCastPerTurn: 3,
    maxCastPerTarget: 2,
    hits: [{ element: 'earth', normal: [22, 26], crit: [26, 31] }],
    combatModifiers: [],
    combatRelevant: true
  });

  const result = optimizeCombatSequence({
    baseStats: { ap: 9, earth: 0, crit: 0 },
    spells: [accumulation],
    objective: { turnMode: 't1', allowSupport: true },
    beamWidth: 500
  });

  assert.equal(result.sequence.length, 3);
  assert.equal(result.sequence[0].spellId, 'spell-13138');
  assert.equal(result.sequence[0].selfCast, true);
  assert.equal(result.sequence[0].expectedDamage, 0);
  assert.ok(result.sequence[0].chargeApplied.expectedBaseDamageBonus > 20);

  const attacks = result.sequence.filter((entry) => !entry.selfCast);
  assert.equal(attacks.length, 2);
  assert.ok(attacks.every((entry) => entry.chargeBonusApplied > 20));
  assert.ok(result.totalDamage > 80, `expected charged Accumulation sequence, got ${result.totalDamage}`);
});

test('Iop Precipitation grants 5 AP now and carries a real -5 AP debt into the next turn', () => {
  const precipitation = applyCuratedSpellRules({
    id: 'spell-13114',
    ankamaId: 13114,
    name: 'Précipitation',
    apCost: 2,
    initialCooldown: 1,
    minCastInterval: 2,
    maxCastPerTurn: 1,
    maxCastPerTarget: 1,
    hits: [],
    combatModifiers: [{
      id: 'precipitation-ap',
      scope: 'self',
      stats: { ap: 5 },
      durationTurns: 1,
      stacking: 'replace-source'
    }],
    combatRelevant: true
  });
  const hit = damageSpell({ id: 'hit', apCost: 4, base: 100, maxCastPerTurn: 2 });

  const result = optimizeCombatSequence({
    baseStats: { ap: 7, earth: 0 },
    baseStatsByTurn: {
      1: { ap: 7, earth: 0, finalDamagePct: -100 },
      2: { ap: 7, earth: 0 },
      3: { ap: 7, earth: 0, finalDamagePct: -100 }
    },
    spells: [hit, precipitation],
    objective: { turnMode: 'sum', allowSupport: true },
    beamWidth: 500,
    interTurnWidth: 30
  });

  const precipitationCast = result.sequence.find((entry) => entry.spellId === 'spell-13114');
  assert.ok(precipitationCast, 'expected the profitable T2 Precipitation cast to be selected');
  assert.equal(precipitationCast.turn, 2);
  assert.ok(precipitationCast.scheduledModifiers.some((modifier) => modifier.stats?.ap === -5 && modifier.delayTurns === 1));
  assert.equal(result.turnStartAp[2], 7);
  assert.equal(result.turnStartAp[3], 2, 'the next turn must start with 7 - 5 AP');
});
