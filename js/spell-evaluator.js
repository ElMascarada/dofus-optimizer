import { statsWithCombatModifiers } from './combat-state.js';
import {
  CombatEffectType,
  activeSpellCharges,
  applyCombatEffects,
  spellCombatEffects,
  spellWithActiveCombatCharge
} from './combat/effects.js';
import { defaultCombatMechanicsRegistry } from './combat/mechanics/default-registry.js';
import { spellDamageVariants } from './spells.js';
import { SpellSupportStatus, classifySpellSupport } from './spell-support.js';

function num(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function targetMultiplier(state, turn) {
  const targetStats = statsWithCombatModifiers({}, state.modifiers || [], turn, 'target');
  const additive = 1 + num(targetStats.finalDamageTakenPct, 0) / 100;
  const multiplicative = 1 + num(targetStats.finalDamageTakenMultiplierPct, 0) / 100;
  return Math.max(0, additive * multiplicative);
}

function scaledRange(range = [0, 0], multiplier = 1) {
  return (range || [0, 0]).map((value) => Number(value || 0) * multiplier);
}

function bestVariant(variants = []) {
  return variants.reduce((best, current) => !best || current.expected > best.expected ? current : best, null);
}

function publicEffect(effect = {}) {
  const copy = { ...effect };
  if (copy.stats) copy.stats = { ...copy.stats };
  if (copy.effect) copy.effect = publicEffect(copy.effect);
  if (copy.effects) copy.effects = copy.effects.map(publicEffect);
  return copy;
}

export function evaluateSpell(spell, characterStats = {}, combatState = {}) {
  const prepared = defaultCombatMechanicsRegistry.prepareSpell(spell || {});
  const support = classifySpellSupport(prepared);
  if (support.status === SpellSupportStatus.UNSUPPORTED) {
    return {
      spellId: prepared.id ?? null,
      name: prepared.name ?? null,
      supportStatus: support.status,
      supportReason: support.reason,
      supported: false,
      normalDamage: null,
      criticalDamage: null,
      expectedDamage: null,
      effectsApplied: []
    };
  }

  const turn = Math.max(1, Number(combatState.turn || 1));
  const state = {
    modifiers: combatState.modifiers || [],
    combatStates: combatState.combatStates || {},
    spellCharges: activeSpellCharges(combatState.spellCharges || {}, turn)
  };
  const selfStats = statsWithCombatModifiers(characterStats, state.modifiers, turn, 'self');
  const charged = spellWithActiveCombatCharge(prepared, state.spellCharges, turn);
  const variant = bestVariant(spellDamageVariants(charged, selfStats, turn));
  const multiplier = targetMultiplier(state, turn);
  const baseEffects = spellCombatEffects(prepared).filter((effect) => ![
    CombatEffectType.DAMAGE,
    CombatEffectType.COOLDOWN,
    CombatEffectType.CAST_LIMIT
  ].includes(effect.type));

  let postState = applyCombatEffects(state, baseEffects, {
    sourceId: String(prepared.id || 'spell'),
    turn,
    context: { spell: prepared, variant }
  });
  const mechanicEffects = [];
  if (variant) {
    for (const group of defaultCombatMechanicsRegistry.hookEffects('afterDamage', {
      spell: prepared,
      variant,
      turn,
      state: postState
    })) {
      mechanicEffects.push(...group.effects.map(publicEffect));
      postState = applyCombatEffects(postState, group.effects, {
        sourceId: `mechanic:${group.definitionId}`,
        turn,
        context: { spell: prepared, variant, mechanicId: group.definitionId }
      });
    }
  }

  return {
    spellId: prepared.id ?? null,
    name: prepared.name ?? null,
    supportStatus: support.status,
    supportReason: support.reason,
    supported: true,
    element: variant?.element || null,
    distance: variant?.distance || null,
    critChancePct: variant?.critChancePct || 0,
    normalDamage: variant ? scaledRange(variant.normal, multiplier) : [0, 0],
    criticalDamage: variant ? scaledRange(variant.critical, multiplier) : [0, 0],
    expectedDamage: variant ? variant.expected * multiplier : 0,
    effectsApplied: [...baseEffects.map(publicEffect), ...mechanicEffects],
    nextCombatState: {
      modifiers: postState.modifiers || [],
      combatStates: postState.combatStates || {},
      spellCharges: postState.spellCharges || state.spellCharges
    }
  };
}
