import test from 'node:test';
import assert from 'node:assert/strict';

import { defaultCombatMechanicsRegistry } from '../js/combat/mechanics/default-registry.js';
import { applyCombatEffects } from '../js/combat/effects.js';
import { optimizeCombatSequence } from '../js/turn-optimizer.js';

function damageSpell({ id, apCost = 2, base = 10, element = 'earth', breedId = null } = {}) {
  return {
    id,
    name: id,
    breedId,
    apCost,
    baseCritPct: 0,
    maxCastPerTurn: 1,
    maxCastPerTarget: 1,
    distanceOptions: ['melee', 'ranged'],
    hits: [{ element, normal: [base, base], crit: [base, base] }],
    combatModifiers: [],
    combatRelevant: true
  };
}

test('Iop mechanics are prepared by the mechanics registry instead of the engine', () => {
  const accumulation = defaultCombatMechanicsRegistry.prepareSpell({
    id: 'spell-13138',
    ankamaId: 13138,
    hits: [{ element: 'earth', normal: [22, 26], crit: [26, 31] }],
    combatModifiers: []
  });
  assert.equal(accumulation.selfCharge.targetSpellId, 'spell-13138');
  assert.equal(accumulation.curatedCombatRule, 'accumulation-self-charge');

  const precipitation = defaultCombatMechanicsRegistry.prepareSpell({
    id: 'spell-13114',
    ankamaId: 13114,
    combatModifiers: [{ id: 'ap-now', scope: 'self', stats: { ap: 5 }, durationTurns: 1 }]
  });
  assert.ok(precipitation.delayedCombatModifiers.some((modifier) => modifier.stats.ap === -5 && modifier.delayTurns === 1));
});

test('Huppermage one-of-element damage is prepared by the registry', () => {
  const spell = defaultCombatMechanicsRegistry.prepareSpell({
    id: 'spell-13672',
    breedId: 17,
    hits: ['earth', 'fire', 'water', 'air'].map((element) => ({ element, normal: [20, 20], crit: [20, 20] }))
  });
  assert.equal(spell.damageSelection, 'one-of-elements');
  assert.equal(spell.curatedDamageRule, 'one-of-element-damage');
});

test('Huppermage element combination returns generic State and TargetModifier effects', () => {
  const earth = damageSpell({ id: 'earth', breedId: 17, element: 'earth' });
  const fire = damageSpell({ id: 'fire', breedId: 17, element: 'fire' });
  let state = { modifiers: [], combatStates: {} };

  for (const group of defaultCombatMechanicsRegistry.hookEffects('afterDamage', {
    spell: earth,
    variant: { element: 'earth' },
    turn: 1,
    state
  })) {
    state = applyCombatEffects(state, group.effects, { sourceId: `mechanic:${group.definitionId}`, turn: 1 });
  }
  const groups = defaultCombatMechanicsRegistry.hookEffects('afterDamage', {
    spell: fire,
    variant: { element: 'fire' },
    turn: 1,
    state
  });
  assert.ok(groups.flatMap((group) => group.effects).some((effect) => effect.type === 'TargetModifier'));
});

test('reference earth-fire sequence keeps the pre-migration 135 damage fingerprint', () => {
  const earth = damageSpell({ id: 'earth', apCost: 2, base: 10, element: 'earth', breedId: 17 });
  const fire = damageSpell({ id: 'fire', apCost: 2, base: 10, element: 'fire', breedId: 17 });
  const finisher = damageSpell({ id: 'finisher', apCost: 2, base: 100, element: 'air', breedId: 17 });
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
