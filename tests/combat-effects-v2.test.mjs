import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CombatEffectType,
  applyCombatEffects,
  combatStateValue,
  spellCombatEffects
} from '../js/combat/effects.js';

test('generic combat effect model exposes every V2 effect family', () => {
  assert.deepEqual(Object.values(CombatEffectType).sort(), [
    'CastLimit',
    'Conditional',
    'ConsumeState',
    'Cooldown',
    'Damage',
    'DelayedEffect',
    'SpellCharge',
    'State',
    'StatModifier',
    'TargetModifier'
  ].sort());
});

test('legacy spell fields are projected into generic combat effects without changing data semantics', () => {
  const effects = spellCombatEffects({
    id: 'spell-x',
    maxCastPerTurn: 2,
    maxCastPerTarget: 1,
    minCastInterval: 2,
    initialCooldown: 1,
    hits: [{ element: 'earth', normal: [10, 12], crit: [12, 14] }],
    combatModifiers: [{ id: 'power', scope: 'self', stats: { power: 100 }, durationTurns: 2 }],
    delayedCombatModifiers: [{ id: 'debt', scope: 'self', stats: { ap: -2 }, delayTurns: 1, durationTurns: 1 }],
    selfCharge: { id: 'charge', targetSpellId: 'spell-x', baseDamageBonus: 20, durationTurns: 3 }
  });

  assert.ok(effects.some((effect) => effect.type === CombatEffectType.DAMAGE));
  assert.ok(effects.some((effect) => effect.type === CombatEffectType.STAT_MODIFIER));
  assert.ok(effects.some((effect) => effect.type === CombatEffectType.DELAYED_EFFECT));
  assert.ok(effects.some((effect) => effect.type === CombatEffectType.SPELL_CHARGE));
  assert.ok(effects.some((effect) => effect.type === CombatEffectType.COOLDOWN));
  assert.ok(effects.some((effect) => effect.type === CombatEffectType.CAST_LIMIT));
});

test('State, ConsumeState, TargetModifier, DelayedEffect and Conditional share one generic interpreter', () => {
  const state = applyCombatEffects({ modifiers: [], combatStates: {} }, [
    { type: CombatEffectType.STATE, key: 'stance', value: 'ready', durationTurns: 2 },
    {
      type: CombatEffectType.CONDITIONAL,
      condition: { stateKey: 'stance', equals: 'ready' },
      effects: [{ type: CombatEffectType.TARGET_MODIFIER, id: 'vuln', stats: { finalDamageTakenPct: 15 }, durationTurns: 1 }]
    },
    {
      type: CombatEffectType.DELAYED_EFFECT,
      delayTurns: 1,
      effect: { type: CombatEffectType.STAT_MODIFIER, id: 'debt', stats: { ap: -2 }, durationTurns: 1 }
    }
  ], { sourceId: 'test', turn: 1 });

  assert.equal(combatStateValue(state.combatStates, 'stance', 1), 'ready');
  assert.ok(state.modifiers.some((modifier) => modifier.scope === 'target' && modifier.stats.finalDamageTakenPct === 15));
  assert.ok(state.modifiers.some((modifier) => modifier.stats.ap === -2 && modifier.appliedTurn === 2));

  const consumed = applyCombatEffects(state, [
    { type: CombatEffectType.CONSUME_STATE, key: 'stance' }
  ], { sourceId: 'test', turn: 1 });
  assert.equal(combatStateValue(consumed.combatStates, 'stance', 1), null);
});
