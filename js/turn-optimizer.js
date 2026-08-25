import { spellDamageVariants } from './spells.js';
import {
  applyTimedModifiers,
  combatModifierSignature,
  expireCombatModifiers,
  statsWithCombatModifiers
} from './combat-state.js';

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
  const totalCastCount = state.castCounts[id] || 0;
  const perTurn = positiveInt(spell.maxCastPerTurn || 99, 99);
  const perTarget = positiveInt(spell.maxCastPerTarget || perTurn, perTurn);
  if (totalCastCount >= perTurn) return false;
  if ((state.targetCastCounts?.[targetCastKey(id, targetKind)] || 0) >= perTarget) return false;
  const readyTurn = num(state.cooldowns[id], 1);
  if (readyTurn > turn) return false;
  const initialCooldown = Math.max(0, num(spell.initialCooldown || 0));
  if (!state.sequence.some((entry) => entry.spellId === id) && turn <= initialCooldown) return false;
  return true;
}

function targetDamageMultiplier(state, turn = 1) {
  const targetStats = statsWithCombatModifiers({}, state.modifiers, turn, 'target');
  const genericTakenPct = num(targetStats.finalDamageTakenPct, 0);
  const hupperTakenPct = state.hupperTarget?.vulnerabilityTurn === turn
    ? num(state.hupperTarget?.vulnerabilityPct, 0)
    : 0;
  return Math.max(0, (1 + genericTakenPct / 100) * (1 + hupperTakenPct / 100));
}

function areaMultiplier(spell, objective = {}) {
  if (objective.targetMode !== 'zone') return 1;
  if (!spell.isArea) return 1;
  return positiveInt(objective.areaTargets, 2);
}

function normalizedText(value = '') {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function isHuppermageSpell(spell) {
  return Number(spell?.breedId) === 17
    || normalizedText(spell?.breedName).includes('huppermage')
    || String(spell?.id || '').startsWith('spell-13') && normalizedText(spell?.breedName) === 'huppermage';
}

function isEarthFirePair(first, second) {
  return (first === 'earth' && second === 'fire') || (first === 'fire' && second === 'earth');
}

function applyHuppermageTargetState(state, spell, variant, turn) {
  if (!isHuppermageSpell(spell)) return state.hupperTarget;
  const element = variant?.element;
  if (!['earth', 'fire', 'water', 'air'].includes(element)) return state.hupperTarget;

  const previous = state.hupperTarget?.turn === turn ? state.hupperTarget : {
    turn,
    element: null,
    vulnerabilityPct: 0,
    vulnerabilityTurn: turn
  };
  const activatesVolcanic = isEarthFirePair(previous.element, element);
  return {
    turn,
    element,
    vulnerabilityPct: Math.max(num(previous.vulnerabilityPct, 0), activatesVolcanic ? 15 : 0),
    vulnerabilityTurn: turn
  };
}

function activeSpellCharges(charges = {}, turn = 1) {
  const result = {};
  for (const [spellId, charge] of Object.entries(charges || {})) {
    if (Number(charge?.appliedTurn || 1) > turn) continue;
    if (Number(charge?.expiresAfterTurn || 0) < turn) continue;
    result[spellId] = { ...charge };
  }
  return result;
}

function chargeSignature(charges = {}, turn = 1) {
  return Object.entries(activeSpellCharges(charges, turn))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, charge]) => `${id}:${Number(charge.bonus || 0).toFixed(3)}:${charge.expiresAfterTurn}`)
    .join('|');
}

function addToRange(range, amount) {
  if (!Array.isArray(range)) return range;
  return range.map((value) => Number(value || 0) + amount);
}

function spellWithActiveCharge(spell, state, turn) {
  const charge = activeSpellCharges(state.spellCharges, turn)[String(spell.id)];
  if (!charge || !(spell.hits || []).length) return spell;
  const bonus = Number(charge.bonus || 0);
  return {
    ...spell,
    hits: spell.hits.map((hit, index) => index === 0 ? {
      ...hit,
      normal: addToRange(hit.normal, bonus),
      crit: addToRange(hit.crit ?? hit.normal, bonus)
    } : hit)
  };
}

function applySpellState(spell, state, turn, targetKind) {
  const cost = Math.max(0, num(spell.apCost, 0));
  let modifiers = applyTimedModifiers(state.modifiers, spell.combatModifiers || [], spell.id, turn);
  modifiers = applyTimedModifiers(modifiers, spell.delayedCombatModifiers || [], spell.id, turn);
  let apRemaining = state.apRemaining - cost;

  // Only modifiers that start now change the current PA pool. Delayed modifiers
  // are kept in state and become active when startTurnState reaches their turn.
  for (const modifier of (spell.combatModifiers || [])) {
    if ((modifier.scope || 'self') !== 'self') continue;
    if (Math.max(0, Number(modifier.delayTurns || 0)) > 0) continue;
    apRemaining += num(modifier.stats?.ap, 0);
  }

  const id = String(spell.id);
  const castCounts = { ...state.castCounts, [id]: (state.castCounts[id] || 0) + 1 };
  const key = targetCastKey(id, targetKind);
  const targetCastCounts = { ...state.targetCastCounts, [key]: (state.targetCastCounts?.[key] || 0) + 1 };
  const cooldowns = { ...state.cooldowns };
  const interval = Math.max(0, num(spell.minCastInterval || spell.cooldown || 0));
  if (interval > 0) cooldowns[id] = turn + interval;

  return { cost, modifiers, apRemaining, castCounts, targetCastCounts, cooldowns };
}

function castSpellVariant(spell, variant, state, turn, objective, targetKind = 'enemy') {
  const dealt = variant
    ? variant.expected
      * targetDamageMultiplier(state, turn)
      * areaMultiplier(spell, objective)
    : 0;

  const next = applySpellState(spell, state, turn, targetKind);
  const hupperTarget = variant ? applyHuppermageTargetState(state, spell, variant, turn) : state.hupperTarget;
  const charge = activeSpellCharges(state.spellCharges, turn)[String(spell.id)];
  return {
    ...state,
    ...next,
    hupperTarget,
    damage: state.damage + dealt,
    sequence: [...state.sequence, {
      turn,
      spellId: spell.id,
      name: spell.name,
      iconId: spell.iconId,
      apCost: next.cost,
      apRemainingAfterCast: next.apRemaining,
      expectedDamage: dealt,
      element: variant?.element || null,
      distance: variant?.distance || null,
      critChancePct: variant?.critChancePct || 0,
      targetDamageMultiplier: targetDamageMultiplier(state, turn),
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
  const config = spell.selfCharge || {};
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
  const chargedSpell = spellWithActiveCharge(spell, state, turn);
  const variants = (chargedSpell.hits || []).length ? spellDamageVariants(chargedSpell, selfStats, turn) : [null];
  return variants.map((variant) => castSpellVariant(spell, variant, state, turn, objective, (spell.hits || []).length ? 'enemy' : 'support'));
}

function actionCandidatesForSpell(spell, state, turn, objective) {
  const candidates = [];
  const hasDamage = (spell.hits || []).length > 0;
  const hasModifiers = (spell.combatModifiers || []).length > 0 || (spell.delayedCombatModifiers || []).length > 0;

  if ((hasDamage || hasModifiers) && (hasDamage || objective.allowSupport)) {
    const targetKind = hasDamage ? 'enemy' : 'support';
    if (spellUsableOnTurn(spell, state, turn, targetKind)) {
      candidates.push(...castAttackCandidates(spell, state, turn, objective));
    }
  }

  if (spell.selfCharge && objective.allowSupport && spellUsableOnTurn(spell, state, turn, 'self')) {
    candidates.push(castSelfCharge(spell, state, turn));
  }
  return candidates;
}

function stateKey(state, turn) {
  const casts = Object.entries(state.castCounts || {}).sort(([a], [b]) => a.localeCompare(b)).map(([id, count]) => `${id}:${count}`).join(',');
  const targetCasts = Object.entries(state.targetCastCounts || {}).sort(([a], [b]) => a.localeCompare(b)).map(([id, count]) => `${id}:${count}`).join(',');
  const cooldowns = Object.entries(state.cooldowns || {}).filter(([, ready]) => num(ready, 0) > turn).sort(([a], [b]) => a.localeCompare(b)).map(([id, ready]) => `${id}:${ready}`).join(',');
  const hupper = state.hupperTarget?.turn === turn
    ? `${state.hupperTarget?.element || '-'}:${num(state.hupperTarget?.vulnerabilityPct, 0)}`
    : '-:0';
  return `${Math.round(state.apRemaining * 100) / 100}|${combatModifierSignature(state.modifiers, turn)}|${chargeSignature(state.spellCharges, turn)}|${hupper}|${casts}|${targetCasts}|${cooldowns}`;
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
    + num(state.hupperTarget?.vulnerabilityPct, 0) * 14
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
  const turnBase = baseStatsForTurn(previous, turn);
  const stats = statsWithCombatModifiers(turnBase, modifiers, turn, 'self');
  const startAp = Math.max(0, num(stats.ap, turnBase.ap || 0));
  return {
    ...previous,
    turn,
    modifiers,
    spellCharges,
    hupperTarget: { turn, element: null, vulnerabilityPct: 0, vulnerabilityTurn: turn },
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
  const candidates = (spells || []).filter((spell) =>
    spell?.combatRelevant !== false
    && Math.max(0, num(spell.apCost, 0)) <= Math.max(0, num(firstTurnBase.ap, 0) + 12)
    && ((spell.hits || []).length
      || (spell.combatModifiers || []).length
      || (spell.delayedCombatModifiers || []).length
      || spell.selfCharge)
  );
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
    hupperTarget: { turn: firstTurn, element: null, vulnerabilityPct: 0, vulnerabilityTurn: firstTurn },
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
