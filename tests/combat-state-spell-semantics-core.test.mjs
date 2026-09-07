import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SpellEffectSemanticStatus,
  SpellEffectSemanticType,
  UnresolvedSpellSemanticError,
  assertCertifiedSpellSemantics,
  certifiedSpellSemanticEligibility,
  resolveSpellEffectSemantic,
  spellEffectSemanticFromCombatEffect,
  spellEffectSemanticsFromCombatEffects
} from '../js/combat/spell-effect-semantic.js';
import {
  advanceCombatTurn,
  applyCombatAction,
  applyCombatStateValue,
  applySpellEffectSemantic,
  combatCastEligibility,
  combatStateSemanticSupport,
  combatStateValue,
  consumeCombatStateValue,
  consumeNextCastModifiers,
  createCombatState,
  endCombatTurn,
  recordCombatCast,
  spendCombatAp,
  startCombatTurn,
  transitionCombatState
} from '../js/combat/state.js';

const S = SpellEffectSemanticStatus.SUPPORTED;

function semantic(type, value = {}) {
  return { type, status: S, ...value };
}

test('SpellEffectSemantic exposes the required generic families and conservative statuses', () => {
  assert.deepEqual(Object.values(SpellEffectSemanticType).sort(), [
    'damage',
    'stat_modifier',
    'state',
    'trigger',
    'charge',
    'next_cast_modifier',
    'delayed_effect',
    'cooldown',
    'cast_limit',
    'condition',
    'target',
    'movement'
  ].sort());
  assert.deepEqual(Object.values(SpellEffectSemanticStatus).sort(), ['SUPPORTED', 'UNRESOLVED']);

  const support = combatStateSemanticSupport();
  assert.equal(support[SpellEffectSemanticType.NEXT_CAST_MODIFIER], S);
  assert.equal(support[SpellEffectSemanticType.TARGET], SpellEffectSemanticStatus.UNRESOLVED);
  assert.equal(support[SpellEffectSemanticType.MOVEMENT], SpellEffectSemanticStatus.UNRESOLVED);
});

test('existing combat effects can be projected into the semantic contract without spell identity logic', () => {
  const projected = spellEffectSemanticFromCombatEffect({
    type: 'TargetModifier',
    id: 'generic-vulnerability',
    stats: { finalDamageTakenPct: 10 },
    durationTurns: 1
  });
  assert.equal(projected.type, SpellEffectSemanticType.STAT_MODIFIER);
  assert.equal(projected.status, S);
  assert.equal(projected.target, 'target');

  const [charge] = spellEffectSemanticsFromCombatEffects([{
    type: 'SpellCharge',
    id: 'future-hit',
    targetSpellId: 'attack',
    durationTurns: 3,
    baseDamageBonus: 20,
    critBaseDamageBonus: 24
  }]);
  assert.equal(charge.type, SpellEffectSemanticType.NEXT_CAST_MODIFIER);
  assert.deepEqual(resolveSpellEffectSemantic(charge, { critical: false }).payload, { baseDamageBonus: 20 });
  assert.deepEqual(resolveSpellEffectSemantic(charge, { critical: true }).payload, { baseDamageBonus: 24 });
});

test('CombatState initial shape carries persistent resources and search-relevant state', () => {
  const state = createCombatState({
    turn: 1,
    baseAp: 12,
    baseMp: 6,
    initialCooldowns: { opening: 1 }
  });

  assert.equal(state.turn, 1);
  assert.equal(state.baseAp, 12);
  assert.equal(state.currentAp, 12);
  assert.equal(state.baseMp, 6);
  assert.equal(state.currentMp, 6);
  assert.deepEqual(state.activeBuffs, []);
  assert.deepEqual(state.activeTargetDebuffs, []);
  assert.deepEqual(state.castsThisTurn, {});
  assert.deepEqual(state.castsPerTarget, {});
  assert.deepEqual(state.states, {});
  assert.deepEqual(state.charges, {});
  assert.deepEqual(state.pendingEffects, []);
  assert.deepEqual(state.spellLocalState, {});
  assert.deepEqual(state.nextCastModifiers, {});
  assert.equal(state.cooldowns.opening, 2);
});

test('CombatState transitions derive branches without mutating their parent and spend AP deterministically', () => {
  const parent = createCombatState({ baseAp: 10, baseMp: 5 });
  const child = spendCombatAp(parent, 4);
  assert.equal(parent.currentAp, 10);
  assert.equal(child.currentAp, 6);
  child.cooldowns.example = 99;
  assert.deepEqual(parent.cooldowns, {});
});

test('cast counters enforce per-turn and per-target limits while cooldowns survive between turns', () => {
  let state = createCombatState({ baseAp: 12, initialCooldowns: { initial: 1 } });
  assert.equal(combatCastEligibility(state, { spellId: 'initial' }).reason, 'COOLDOWN');

  state = recordCombatCast(state, { spellId: 'attack', targetId: 'enemy-a', cooldownTurns: 2 });
  assert.equal(state.castsThisTurn.attack, 1);
  assert.equal(state.castsPerTarget['enemy-a:attack'], 1);
  assert.equal(combatCastEligibility(state, {
    spellId: 'attack',
    targetId: 'enemy-a',
    castLimit: { perTurn: 2, perTarget: 1 }
  }).reason, 'COOLDOWN');

  state = startCombatTurn(state, 2);
  assert.deepEqual(state.castsThisTurn, {});
  assert.equal(combatCastEligibility(state, { spellId: 'attack' }).reason, 'COOLDOWN');
  state = startCombatTurn(state, 3);
  assert.equal(combatCastEligibility(state, { spellId: 'attack' }).eligible, true);

  let limited = createCombatState({ baseAp: 12 });
  limited = recordCombatCast(limited, { spellId: 'limited', targetId: 'enemy-a' });
  assert.equal(combatCastEligibility(limited, {
    spellId: 'limited', targetId: 'enemy-a', castLimit: { perTurn: 2, perTarget: 1 }
  }).reason, 'CAST_LIMIT_TARGET');
  limited = recordCombatCast(limited, { spellId: 'limited', targetId: 'enemy-b' });
  assert.equal(combatCastEligibility(limited, {
    spellId: 'limited', targetId: 'enemy-c', castLimit: { perTurn: 2, perTarget: 1 }
  }).reason, 'CAST_LIMIT_TURN');
});

test('deterministic buffs modify current resources, retain duration and expire at the next boundary', () => {
  const initial = createCombatState({ baseAp: 7, baseMp: 4 });
  const buffed = applySpellEffectSemantic(initial, semantic('stat_modifier', {
    id: 'resource-buff',
    stats: { ap: 5, mp: 2, power: 100 },
    durationTurns: 1
  }), { sourceId: 'support-spell' });

  assert.equal(initial.currentAp, 7);
  assert.equal(buffed.currentAp, 12);
  assert.equal(buffed.currentMp, 6);
  assert.equal(buffed.activeBuffs[0].stats.power, 100);

  const next = advanceCombatTurn(buffed);
  assert.equal(next.turn, 2);
  assert.equal(next.currentAp, 7);
  assert.equal(next.currentMp, 4);
  assert.deepEqual(next.activeBuffs, []);
});

test('state semantics apply, persist for their duration and can be consumed without mutation', () => {
  const initial = createCombatState({ baseAp: 8 });
  const applied = applyCombatStateValue(initial, {
    key: 'stance', value: { ready: true }, durationTurns: 2, sourceId: 'setup'
  });
  assert.equal(combatStateValue(initial, 'stance'), null);
  assert.deepEqual(combatStateValue(applied, 'stance'), { ready: true });

  const consumed = consumeCombatStateValue(applied, 'stance');
  assert.deepEqual(combatStateValue(applied, 'stance'), { ready: true });
  assert.equal(combatStateValue(consumed, 'stance'), null);
});

test('delayed effects are pending until their due turn and T1 to T2 transition resolves them', () => {
  const initial = createCombatState({ turn: 1, baseAp: 7 });
  const afterCast = transitionCombatState(initial, {
    spellId: 'temporal-support',
    apCost: 2,
    effects: [
      semantic('stat_modifier', {
        id: 'now-ap', stats: { ap: 5 }, durationTurns: 1
      }),
      semantic('delayed_effect', {
        id: 'later-ap',
        delayTurns: 1,
        effect: semantic('stat_modifier', {
          id: 'debt-ap', stats: { ap: -5 }, durationTurns: 1
        })
      })
    ]
  });

  assert.equal(afterCast.currentAp, 10, '7 AP - 2 cost + 5 immediate AP');
  assert.equal(afterCast.pendingEffects.length, 1);
  assert.equal(initial.pendingEffects.length, 0);

  const turn2 = advanceCombatTurn(afterCast);
  assert.equal(turn2.turn, 2);
  assert.equal(turn2.currentAp, 2, 'turn 2 starts from 7 AP with the pending -5 AP effect');
  assert.equal(turn2.pendingEffects.length, 0);
});

test('start, end and next-turn transitions are explicit and reset turn-local casts', () => {
  let state = createCombatState({ baseAp: 9, baseMp: 5 });
  state = recordCombatCast(state, { spellId: 'attack', targetId: 'enemy' });
  const ended = endCombatTurn(state);
  assert.equal(ended.phase, 'ended');
  assert.equal(state.phase, 'active');

  const next = advanceCombatTurn(ended);
  assert.equal(next.turn, 2);
  assert.equal(next.phase, 'active');
  assert.equal(next.currentAp, 9);
  assert.deepEqual(next.castsThisTurn, {});
  assert.deepEqual(next.castsPerTarget, {});
});

test('generic charge supports stacks, duration and expiration', () => {
  let state = createCombatState({ baseAp: 8 });
  state = applySpellEffectSemantic(state, semantic('charge', {
    id: 'generic-charge',
    stacks: 1,
    maxStacks: 2,
    durationTurns: 2,
    value: { baseDamageBonus: 20 }
  }), { sourceId: 'setup' });
  state = applySpellEffectSemantic(state, semantic('charge', {
    id: 'generic-charge',
    stacks: 2,
    maxStacks: 2,
    durationTurns: 2,
    value: { baseDamageBonus: 20 }
  }), { sourceId: 'setup' });
  assert.equal(state.charges['generic-charge'].stacks, 2);
  assert.ok(state.charges['generic-charge'].value.baseDamageBonus === 20);
  state = advanceCombatTurn(state);
  assert.equal(state.charges['generic-charge'].stacks, 2);
  state = advanceCombatTurn(state);
  assert.equal(state.charges['generic-charge'], undefined);
});

test('next-cast modifiers stack, select normal/critical payloads, consume and expire', () => {
  let state = createCombatState({ baseAp: 12 });
  const modifier = semantic('next_cast_modifier', {
    id: 'charged-hit',
    targetSpellId: 'attack',
    durationTurns: 2,
    stacks: 2,
    maxStacks: 2,
    consumeStacks: 1,
    normalPayload: { baseDamageBonus: 20 },
    criticalPayload: { baseDamageBonus: 24 }
  });
  state = applySpellEffectSemantic(state, modifier, { sourceId: 'setup' });
  assert.equal(state.nextCastModifiers['charged-hit'].stacks, 2);

  const normal = consumeNextCastModifiers(state, { spellId: 'attack', critical: false });
  assert.deepEqual(normal.applied[0].payload, { baseDamageBonus: 20 });
  assert.equal(normal.state.nextCastModifiers['charged-hit'].stacks, 1);
  assert.equal(state.nextCastModifiers['charged-hit'].stacks, 2);

  const critical = consumeNextCastModifiers(normal.state, { spellId: 'attack', critical: true });
  assert.deepEqual(critical.applied[0].payload, { baseDamageBonus: 24 });
  assert.equal(critical.state.nextCastModifiers['charged-hit'], undefined);

  let expiring = applySpellEffectSemantic(createCombatState({ baseAp: 12 }), semantic('next_cast_modifier', {
    id: 'one-turn', targetSpellId: 'attack', durationTurns: 1, payload: { power: 1 }
  }), { sourceId: 'setup' });
  expiring = advanceCombatTurn(expiring);
  assert.equal(expiring.nextCastModifiers['one-turn'], undefined);
});

test('critical state-changing semantics create separate deterministic branches instead of averaging future state', () => {
  const effect = semantic('next_cast_modifier', {
    id: 'branching-charge',
    targetSpellId: 'attack',
    durationTurns: 3,
    normal: { payload: { baseDamageBonus: 20 } },
    critical: { payload: { baseDamageBonus: 24 } }
  });
  const parent = createCombatState({ baseAp: 9 });
  const normalState = applySpellEffectSemantic(parent, effect, { sourceId: 'setup', critical: false });
  const criticalState = applySpellEffectSemantic(parent, effect, { sourceId: 'setup', critical: true });

  assert.deepEqual(normalState.nextCastModifiers['branching-charge'].payload, { baseDamageBonus: 20 });
  assert.deepEqual(criticalState.nextCastModifiers['branching-charge'].payload, { baseDamageBonus: 24 });
  assert.deepEqual(parent.nextCastModifiers, {});

  const normalResolved = resolveSpellEffectSemantic(effect, { critical: false });
  const critResolved = resolveSpellEffectSemantic(effect, { critical: true });
  assert.notDeepEqual(normalResolved.payload, critResolved.payload);
});

test('combat action transition consumes matching next-cast state before applying new effects', () => {
  let state = createCombatState({ baseAp: 8 });
  state = applySpellEffectSemantic(state, semantic('next_cast_modifier', {
    id: 'prepared', targetSpellId: 'attack', durationTurns: 2, payload: { bonus: 10 }
  }), { sourceId: 'setup' });

  const result = applyCombatAction(state, {
    spellId: 'attack',
    apCost: 3,
    targetId: 'enemy',
    effects: [semantic('damage', { id: 'damage' })]
  });
  assert.equal(result.state.currentAp, 5);
  assert.equal(result.state.castsThisTurn.attack, 1);
  assert.deepEqual(result.appliedNextCastModifiers[0].payload, { bonus: 10 });
  assert.equal(result.state.nextCastModifiers.prepared, undefined);
});

test('unresolved relevant mechanics make a spell ineligible for certified planning instead of falling back to damage only', () => {
  const effects = [
    semantic('damage', { id: 'known-damage' }),
    {
      type: 'movement',
      status: SpellEffectSemanticStatus.UNRESOLVED,
      id: 'unknown-position-effect',
      relevantToPlan: true
    }
  ];
  const eligibility = certifiedSpellSemanticEligibility(effects);
  assert.equal(eligibility.eligible, false);
  assert.equal(eligibility.unresolved[0].id, 'unknown-position-effect');
  assert.throws(() => assertCertifiedSpellSemantics(effects), UnresolvedSpellSemanticError);
  assert.throws(() => transitionCombatState(createCombatState({ baseAp: 6 }), {
    spellId: 'unsafe', apCost: 3, effects
  }), UnresolvedSpellSemanticError);
});
