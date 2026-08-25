import { spellDamageVariants } from './spells.js';
import {
  combatModifierSignature,
  expireCombatModifiers,
  statsWithCombatModifiers
} from './combat-state.js';
import {
  CombatEffectType,
  activeSpellCharges,
  applyCombatEffects,
  combatEffectsOfType,
  combatStateSignature,
  expireCombatStates,
  firstCombatEffect,
  spellChargeSignature,
  spellCombatEffects,
  spellWithActiveCombatCharge
} from './combat/effects.js';
import { defaultCombatMechanicsRegistry } from './combat/mechanics/default-registry.js';

function num(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function positiveInt(value, fallback = 1) {
  return Math.max(1, Math.floor(num(value, fallback)));
}

function activeTurns(turnMode = 't1') {
  if (turnMode === 't2') return [2];
  if (turnMode === 't3') return [3];
  if (turnMode === 'sum' || turnMode === 'average' || turnMode === 'min') return [1, 2, 3];
  return [1];
}

function objectiveTurns(objective = {}) {
  const validMode = ['t1', 't2', 't3', 'sum', 'average', 'min'].includes(objective.turnMode);
  if (validMode) return { turnMode: objective.turnMode, turns: activeTurns(objective.turnMode) };
  const legacyCount = Math.max(1, Math.min(3, positiveInt(objective.turns, 1)));
  return {
    turnMode: legacyCount === 1 ? 't1' : `legacy-${legacyCount}`,
    turns: [1, 2, 3].slice(0, legacyCount)
  };
}

function baseStatsForTurn(state, turn) {
  return state.baseStatsByTurn?.[turn] || state.baseStats || {};
}

function targetCastKey(spellId, targetKind) {
  return `${targetKind}:${String(spellId)}`;
}

function spellUsableOnTurn(spell, state, turn, targetKind = 'enemy') {
  const cost = Math.max(0, num(spell.apCost, 0));
  if (cost > state.apRemaining) return false;
  const id = String(spell.id);
  const limit = firstCombatEffect(spell, CombatEffectType.CAST_LIMIT) || {};
  const totalCastCount = state.castCounts[id] || 0;
  const perTurn = positiveInt(limit.perTurn || 99, 99);
  const perTarget = positiveInt(limit.perTarget || perTurn, perTurn);
  if (totalCastCount >= perTurn) return false;
  if ((state.targetCastCounts?.[targetCastKey(id, targetKind)] || 0) >= perTarget) return false;

  const cooldown = firstCombatEffect(spell, CombatEffectType.COOLDOWN) || {};
  const readyTurn = num(state.cooldowns[id], 1);
  if (readyTurn > turn) return false;
  const initialCooldown = Math.max(0, num(cooldown.initialTurns, 0));
  if (!state.sequence.some((entry) => entry.spellId === id) && turn <= initialCooldown) return false;
  return true;
}

function targetDamageMultiplier(state, turn = 1) {
  const targetStats = statsWithCombatModifiers({}, state.modifiers, turn, 'target');
  const additive = 1 + num(targetStats.finalDamageTakenPct, 0) / 100;
  const multiplicative = 1 + num(targetStats.finalDamageTakenMultiplierPct, 0) / 100;
  return Math.max(0, additive * multiplicative);
}

function areaMultiplier(spell, objective = {}) {
  if (objective.targetMode !== 'zone') return 1;
  if (!spell.isArea) return 1;
  return positiveInt(objective.areaTargets, 2);
}

function applySpellState(spell, state, turn, targetKind) {
  const cost = Math.max(0, num(spell.apCost, 0));
  const effects = spellCombatEffects(spell);
  const effected = applyCombatEffects(state, effects, {
    sourceId: String(spell.id),
    turn,
    context: { spell, targetKind }
  });
  const apDelta = effects
    .filter((effect) => effect.type === CombatEffectType.STAT_MODIFIER)
    .reduce((sum, effect) => sum + num(effect.stats?.ap, 0), 0);
  const apRemaining = state.apRemaining - cost + apDelta;

  const id = String(spell.id);
  const castCounts = { ...state.castCounts, [id]: (state.castCounts[id] || 0) + 1 };
  const key = targetCastKey(id, targetKind);
  const targetCastCounts = { ...state.targetCastCounts, [key]: (state.targetCastCounts?.[key] || 0) + 1 };
  const cooldowns = { ...state.cooldowns };
  const cooldown = firstCombatEffect(effects, CombatEffectType.COOLDOWN);
  const interval = Math.max(0, num(cooldown?.intervalTurns, 0));
  if (interval > 0) cooldowns[id] = turn + interval;

  return {
    cost,
    modifiers: effected.modifiers || [],
    combatStates: effected.combatStates || {},
    apRemaining,
    castCounts,
    targetCastCounts,
    cooldowns
  };
}

function applyMechanicHook(state, hookName, context) {
  let next = state;
  for (const group of defaultCombatMechanicsRegistry.hookEffects(hookName, { ...context, state: next })) {
    next = applyCombatEffects(next, group.effects, {
      sourceId: `mechanic:${group.definitionId}`,
      turn: context.turn,
      context: { ...context, state: next, mechanicId: group.definitionId }
    });
  }
  return next;
}

function castSpellVariant(spell, variant, state, turn, objective, targetKind = 'enemy') {
  const multiplier = targetDamageMultiplier(state, turn);
  const dealt = variant
    ? variant.expected * multiplier * areaMultiplier(spell, objective)
    : 0;

  const nextFields = applySpellState(spell, state, turn, targetKind);
  let nextState = { ...state, ...nextFields };
  if (variant) {
    nextState = applyMechanicHook(nextState, 'afterDamage', {
      spell,
      variant,
      turn,
      objective,
      targetKind
    });
  }
  const charge = activeSpellCharges(state.spellCharges, turn)[String(spell.id)];
  return {
    ...nextState,
    damage: state.damage + dealt,
    sequence: [...state.sequence, {
      turn,
      spellId: spell.id,
      name: spell.name,
      iconId: spell.iconId,
      apCost: nextFields.cost,
      apRemainingAfterCast: nextFields.apRemaining,
      expectedDamage: dealt,
      element: variant?.element || null,
      distance: variant?.distance || null,
      critChancePct: variant?.critChancePct || 0,
      targetDamageMultiplier: multiplier,
      areaTargets: areaMultiplier(spell, objective),
      chargeBonusApplied: charge ? Number(charge.bonus || 0) : 0,
      appliedModifiers: (spell.combatModifiers || []).map((modifier) => ({ ...modifier, stats: { ...(modifier.stats || {}) } })),
      scheduledModifiers: (spell.delayedCombatModifiers || []).map((modifier) => ({ ...modifier, stats: { ...(modifier.stats || {}) } }))
    }]
  };
}

function castSelfCharge(spell, state, turn) {
  const next = applySpellState(spell, state, turn, 'self');
  const selfStats = statsWithCombatModifiers(baseStatsForTurn(state, turn), state.modifiers, turn, 'self');
  const config = firstCombatEffect(spell, CombatEffectType.SPELL_CHARGE) || {};
  const critChance = Math.max(0, Math.min(1, (num(spell.baseCritPct, 0) + num(selfStats.crit, 0)) / 100));
  const normalBonus = Math.max(0, num(config.baseDamageBonus, 0));
  const critBonus = Math.max(normalBonus, num(config.critBaseDamageBonus, normalBonus));
  const expectedBonus = normalBonus * (1 - critChance) + critBonus * critChance;
  const targetSpellId = String(config.targetSpellId || spell.id);
  const durationTurns = Math.max(1, Number(config.durationTurns || 1));
  const spellCharges = {
    ...activeSpellCharges(state.spellCharges, turn),
    [targetSpellId]: {
      id: String(config.id || `${spell.id}-charge`),
      sourceSpellId: String(spell.id),
      bonus: expectedBonus,
      normalBonus,
      critBonus,
      critChancePct: critChance * 100,
      appliedTurn: turn,
      expiresAfterTurn: turn + durationTurns - 1
    }
  };

  return {
    ...state,
    ...next,
    spellCharges,
    sequence: [...state.sequence, {
      turn,
      spellId: spell.id,
      name: spell.name,
      iconId: spell.iconId,
      apCost: next.cost,
      apRemainingAfterCast: next.apRemaining,
      expectedDamage: 0,
      element: null,
      distance: 'self',
      critChancePct: critChance * 100,
      selfCast: true,
      chargeApplied: {
        targetSpellId,
        expectedBaseDamageBonus: expectedBonus,
        durationTurns
      },
      appliedModifiers: (spell.combatModifiers || []).map((modifier) => ({ ...modifier, stats: { ...(modifier.stats || {}) } })),
      scheduledModifiers: (spell.delayedCombatModifiers || []).map((modifier) => ({ ...modifier, stats: { ...(modifier.stats || {}) } }))
    }]
  };
}

function castAttackCandidates(spell, state, turn, objective) {
  const selfStats = statsWithCombatModifiers(baseStatsForTurn(state, turn), state.modifiers, turn, 'self');
  const chargedSpell = spellWithActiveCombatCharge(spell, state.spellCharges, turn);
  const variants = combatEffectsOfType(spell, CombatEffectType.DAMAGE).length
    ? spellDamageVariants(chargedSpell, selfStats, turn)
    : [null];
  return variants.map((variant) => castSpellVariant(spell, variant, state, turn, objective, variant ? 'enemy' : 'support'));
}

function actionCandidatesForSpell(spell, state, turn, objective) {
  const candidates = [];
  const effects = spellCombatEffects(spell);
  const hasDamage = effects.some((effect) => effect.type === CombatEffectType.DAMAGE);
  const hasSupportEffects = effects.some((effect) => [
    CombatEffectType.STAT_MODIFIER,
    CombatEffectType.TARGET_MODIFIER,
    CombatEffectType.DELAYED_EFFECT,
    CombatEffectType.STATE,
    CombatEffectType.CONSUME_STATE,
    CombatEffectType.CONDITIONAL
  ].includes(effect.type));
  const hasCharge = effects.some((effect) => effect.type === CombatEffectType.SPELL_CHARGE);

  if ((hasDamage || hasSupportEffects) && (hasDamage || objective.allowSupport)) {
    const targetKind = hasDamage ? 'enemy' : 'support';
    if (spellUsableOnTurn(spell, state, turn, targetKind)) {
      candidates.push(...castAttackCandidates(spell, state, turn, objective));
    }
  }

  if (hasCharge && objective.allowSupport && spellUsableOnTurn(spell, state, turn, 'self')) {
    candidates.push(castSelfCharge(spell, state, turn));
  }
  return candidates;
}

function stateKey(state, turn) {
  const casts = Object.entries(state.castCounts || {}).sort(([a], [b]) => a.localeCompare(b)).map(([id, count]) => `${id}:${count}`).join(',');
  const targetCasts = Object.entries(state.targetCastCounts || {}).sort(([a], [b]) => a.localeCompare(b)).map(([id, count]) => `${id}:${count}`).join(',');
  const cooldowns = Object.entries(state.cooldowns || {}).filter(([, ready]) => num(ready, 0) > turn).sort(([a], [b]) => a.localeCompare(b)).map(([id, ready]) => `${id}:${ready}`).join(',');
  return `${Math.round(state.apRemaining * 100) / 100}|${combatModifierSignature(state.modifiers, turn)}|${spellChargeSignature(state.spellCharges, turn)}|${combatStateSignature(state.combatStates, turn)}|${casts}|${targetCasts}|${cooldowns}`;
}

function supportPotential(state, turn) {
  const selfStats = statsWithCombatModifiers({}, state.modifiers, turn, 'self');
  const targetStats = statsWithCombatModifiers({}, state.modifiers, turn, 'target');
  const chargePotential = Object.values(activeSpellCharges(state.spellCharges, turn))
    .reduce((sum, charge) => sum + Math.max(0, num(charge.bonus, 0)) * 18, 0);
  return num(selfStats.power) * 0.8
    + num(selfStats.damage) * 3
    + num(selfStats.crit) * 4
    + num(selfStats.critDamage) * 2
    + num(selfStats.spellDamagePct) * 10
    + num(selfStats.finalDamagePct) * 14
    + Math.max(num(selfStats.meleeDamagePct), num(selfStats.rangedDamagePct)) * 12
    + num(targetStats.finalDamageTakenPct) * 14
    + num(targetStats.finalDamageTakenMultiplierPct) * 14
    + chargePotential
    + Math.max(0, state.apRemaining) * 3;
}

function keepBestStates(states, turn, beamWidth) {
  const byKey = new Map();
  for (const state of states) {
    const key = stateKey(state, turn);
    const previous = byKey.get(key);
    if (!previous || state.damage > previous.damage) byKey.set(key, state);
  }
  return [...byKey.values()]
    .sort((a, b) => (b.damage + supportPotential(b, turn)) - (a.damage + supportPotential(a, turn)))
    .slice(0, beamWidth);
}

function optimizeSingleTurn({ spells, state, turn, objective, beamWidth = 1600, maxActions = 12 }) {
  let frontier = [state];
  const terminals = [state];
  for (let depth = 0; depth < maxActions; depth++) {
    const next = [];
    for (const current of frontier) {
      let expanded = false;
      for (const spell of spells) {
        for (const candidate of actionCandidatesForSpell(spell, current, turn, objective)) {
          if (candidate.apRemaining < -0.001) continue;
          next.push(candidate);
          expanded = true;
        }
      }
      if (!expanded) terminals.push(current);
    }
    if (!next.length) break;
    frontier = keepBestStates(next, turn, beamWidth);
    terminals.push(...frontier);
  }
  return keepBestStates(terminals, turn, beamWidth);
}

function startTurnState(previous, turn) {
  const modifiers = expireCombatModifiers(previous.modifiers, turn);
  const spellCharges = activeSpellCharges(previous.spellCharges, turn);
  const combatStates = expireCombatStates(previous.combatStates, turn);
  const turnBase = baseStatsForTurn(previous, turn);
  const stats = statsWithCombatModifiers(turnBase, modifiers, turn, 'self');
  const startAp = Math.max(0, num(stats.ap, turnBase.ap || 0));
  return {
    ...previous,
    turn,
    modifiers,
    spellCharges,
    combatStates,
    apRemaining: startAp,
    turnStartAp: { ...(previous.turnStartAp || {}), [turn]: startAp },
    castCounts: {},
    targetCastCounts: {}
  };
}

function finalScore(state, objective) {
  if (objective.metric === 'damage-per-ap') {
    const spent = state.sequence.reduce((sum, entry) => sum + num(entry.apCost), 0);
    return state.damage / Math.max(1, spent);
  }
  if (objective.turnMode === 'average') return state.damage / Math.max(1, objective.activeTurns.length);
  if (objective.turnMode === 'min') {
    const perTurn = {};
    for (const entry of state.sequence) perTurn[entry.turn] = (perTurn[entry.turn] || 0) + num(entry.expectedDamage, 0);
    return Math.min(...objective.activeTurns.map((turn) => perTurn[turn] || 0));
  }
  return state.damage;
}

export function optimizeCombatSequence({
  baseStats = {},
  baseStatsByTurn = null,
  spells = [],
  objective = {},
  beamWidth = 1600,
  interTurnWidth = 24,
  maxActionsPerTurn = 12
} = {}) {
  const selected = objectiveTurns(objective);
  const normalizedObjective = {
    targetMode: objective.targetMode === 'zone' ? 'zone' : 'single',
    areaTargets: positiveInt(objective.areaTargets, 3),
    turnMode: selected.turnMode,
    activeTurns: selected.turns,
    turns: selected.turns.length,
    allowSupport: objective.allowSupport !== false,
    metric: objective.metric === 'damage-per-ap' ? 'damage-per-ap' : 'total-damage'
  };
  const firstTurn = selected.turns[0];
  const firstTurnBase = baseStatsByTurn?.[firstTurn] || baseStats || {};
  const preparedSpells = (spells || []).map((spell) => defaultCombatMechanicsRegistry.prepareSpell(spell));
  const candidates = preparedSpells.filter((spell) => {
    const effects = spellCombatEffects(spell);
    const actionable = effects.some((effect) => ![CombatEffectType.COOLDOWN, CombatEffectType.CAST_LIMIT].includes(effect.type));
    return spell?.combatRelevant !== false
      && Math.max(0, num(spell.apCost, 0)) <= Math.max(0, num(firstTurnBase.ap, 0) + 12)
      && actionable;
  });
  if (!candidates.length) return { score: 0, totalDamage: 0, sequence: [], perTurn: {}, turnStartAp: {}, objective: normalizedObjective, explored: 0 };

  const initialAp = Math.max(0, num(firstTurnBase.ap, 0));
  let frontier = [{
    turn: firstTurn,
    baseStats: { ...baseStats },
    baseStatsByTurn: baseStatsByTurn ? Object.fromEntries(Object.entries(baseStatsByTurn).map(([turn, stats]) => [turn, { ...stats }])) : null,
    apRemaining: initialAp,
    turnStartAp: { [firstTurn]: initialAp },
    modifiers: [],
    spellCharges: {},
    combatStates: {},
    castCounts: {},
    targetCastCounts: {},
    cooldowns: {},
    damage: 0,
    sequence: []
  }];
  let explored = 0;
  const bridgeWidth = Math.max(1, Math.min(Math.max(1, Number(beamWidth || 1)), Math.max(1, Number(interTurnWidth || 1))));

  for (let index = 0; index < selected.turns.length; index++) {
    const turn = selected.turns[index];
    if (index > 0) {
      const previousTurn = selected.turns[index - 1];
      frontier = keepBestStates(frontier, previousTurn, bridgeWidth);
    }
    const turnResults = [];
    for (const previous of frontier) {
      const start = index === 0 ? previous : startTurnState(previous, turn);
      const optimized = optimizeSingleTurn({
        spells: candidates,
        state: start,
        turn,
        objective: normalizedObjective,
        beamWidth,
        maxActions: maxActionsPerTurn
      });
      explored += optimized.length;
      turnResults.push(...optimized);
    }
    frontier = keepBestStates(turnResults, turn, beamWidth);
  }

  const ranked = frontier.sort((a, b) => finalScore(b, normalizedObjective) - finalScore(a, normalizedObjective));
  const best = ranked[0] || frontier[0];
  const perTurn = {};
  for (const turn of selected.turns) perTurn[turn] = 0;
  for (const entry of best?.sequence || []) perTurn[entry.turn] = (perTurn[entry.turn] || 0) + num(entry.expectedDamage, 0);
  return {
    score: best ? finalScore(best, normalizedObjective) : 0,
    totalDamage: best?.damage || 0,
    sequence: best?.sequence || [],
    perTurn,
    turnStartAp: { ...(best?.turnStartAp || {}) },
    objective: normalizedObjective,
    explored
  };
}
