import { spellDamageBreakdown } from './spells.js';
import {
  activeModifiersForTurn,
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

function spellUsableOnTurn(spell, state, turn) {
  const cost = Math.max(0, num(spell.apCost, 0));
  if (cost > state.apRemaining) return false;
  const id = String(spell.id);
  const castCount = state.castCounts[id] || 0;
  const perTurn = positiveInt(spell.maxCastPerTurn || 99, 99);
  const perTarget = positiveInt(spell.maxCastPerTarget || perTurn, perTurn);
  if (castCount >= Math.min(perTurn, perTarget)) return false;
  const readyTurn = num(state.cooldowns[id], 1);
  if (readyTurn > turn) return false;
  return true;
}

function targetDamageMultiplier(modifiers = [], turn = 1) {
  const targetStats = statsWithCombatModifiers({}, modifiers, turn, 'target');
  const takenPct = num(targetStats.finalDamageTakenPct, 0);
  return Math.max(0, 1 + takenPct / 100);
}

function areaMultiplier(spell, objective = {}) {
  if (objective.targetMode !== 'zone') return 1;
  if (!spell.isArea) return 1;
  return positiveInt(objective.areaTargets, 2);
}

function castSpell(spell, state, turn, objective) {
  const selfStats = statsWithCombatModifiers(state.baseStats, state.modifiers, turn, 'self');
  const hasDamage = Array.isArray(spell.hits) && spell.hits.length > 0;
  const breakdown = hasDamage ? spellDamageBreakdown(spell, selfStats, turn) : null;
  const dealt = breakdown
    ? breakdown.expected * targetDamageMultiplier(state.modifiers, turn) * areaMultiplier(spell, objective)
    : 0;

  const cost = Math.max(0, num(spell.apCost, 0));
  const modifiers = applyTimedModifiers(state.modifiers, spell.combatModifiers || [], spell.id, turn);
  let apRemaining = state.apRemaining - cost;

  // A deterministic AP gain applied by the spell can be spent immediately.
  for (const modifier of (spell.combatModifiers || [])) {
    if ((modifier.scope || 'self') !== 'self') continue;
    apRemaining += Math.max(0, num(modifier.stats?.ap, 0));
  }

  const castCounts = { ...state.castCounts, [spell.id]: (state.castCounts[spell.id] || 0) + 1 };
  const cooldowns = { ...state.cooldowns };
  const interval = Math.max(0, num(spell.minCastInterval || spell.cooldown || 0));
  if (interval > 0) cooldowns[spell.id] = turn + interval;

  return {
    ...state,
    apRemaining,
    modifiers,
    castCounts,
    cooldowns,
    damage: state.damage + dealt,
    sequence: [...state.sequence, {
      turn,
      spellId: spell.id,
      name: spell.name,
      apCost: cost,
      expectedDamage: dealt,
      selfStatsBefore: selfStats,
      critChancePct: breakdown?.critChancePct || 0,
      areaTargets: areaMultiplier(spell, objective)
    }]
  };
}

function stateKey(state, turn) {
  const casts = Object.entries(state.castCounts || {}).sort(([a], [b]) => a.localeCompare(b)).map(([id, count]) => `${id}:${count}`).join(',');
  const cooldowns = Object.entries(state.cooldowns || {}).filter(([, ready]) => num(ready, 0) > turn).sort(([a], [b]) => a.localeCompare(b)).map(([id, ready]) => `${id}:${ready}`).join(',');
  return `${Math.round(state.apRemaining * 100) / 100}|${combatModifierSignature(state.modifiers, turn)}|${casts}|${cooldowns}`;
}

function supportPotential(state, turn) {
  const selfStats = statsWithCombatModifiers({}, state.modifiers, turn, 'self');
  const targetStats = statsWithCombatModifiers({}, state.modifiers, turn, 'target');
  return num(selfStats.power) * 0.8
    + num(selfStats.crit) * 4
    + num(selfStats.critDamage) * 2
    + num(selfStats.spellDamagePct) * 10
    + num(selfStats.finalDamagePct) * 14
    + num(targetStats.finalDamageTakenPct) * 14
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
        if (!spellUsableOnTurn(spell, current, turn)) continue;
        if (!objective.allowSupport && !(spell.hits || []).length) continue;
        const candidate = castSpell(spell, current, turn, objective);
        if (candidate.apRemaining < -0.001) continue;
        next.push(candidate);
        expanded = true;
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
  const stats = statsWithCombatModifiers(previous.baseStats, modifiers, turn, 'self');
  return {
    ...previous,
    turn,
    modifiers,
    apRemaining: Math.max(0, num(stats.ap, previous.baseStats.ap || 0)),
    castCounts: {}
  };
}

function finalScore(state, objective) {
  if (objective.metric === 'damage-per-ap') {
    const spent = state.sequence.reduce((sum, entry) => sum + num(entry.apCost), 0);
    return state.damage / Math.max(1, spent);
  }
  return state.damage;
}

export function optimizeCombatSequence({
  baseStats = {},
  spells = [],
  objective = {},
  beamWidth = 1600,
  maxActionsPerTurn = 12
} = {}) {
  const normalizedObjective = {
    targetMode: objective.targetMode === 'zone' ? 'zone' : 'single',
    areaTargets: positiveInt(objective.areaTargets, 3),
    turns: Math.max(1, Math.min(3, positiveInt(objective.turns, 1))),
    allowSupport: objective.allowSupport !== false,
    metric: objective.metric === 'damage-per-ap' ? 'damage-per-ap' : 'total-damage'
  };
  const candidates = (spells || []).filter((spell) =>
    spell?.combatRelevant !== false
    && Math.max(0, num(spell.apCost, 0)) <= Math.max(0, num(baseStats.ap, 0) + 12)
    && ((spell.hits || []).length || (spell.combatModifiers || []).length)
  );
  if (!candidates.length) return { score: 0, totalDamage: 0, sequence: [], perTurn: {}, explored: 0 };

  let frontier = [{
    turn: 1,
    baseStats: { ...baseStats },
    apRemaining: Math.max(0, num(baseStats.ap, 0)),
    modifiers: [],
    castCounts: {},
    cooldowns: {},
    damage: 0,
    sequence: []
  }];
  let explored = 0;

  for (let turn = 1; turn <= normalizedObjective.turns; turn++) {
    const turnResults = [];
    for (const previous of frontier) {
      const start = turn === 1 ? previous : startTurnState(previous, turn);
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
  for (const entry of best?.sequence || []) perTurn[entry.turn] = (perTurn[entry.turn] || 0) + num(entry.expectedDamage, 0);
  return {
    score: best ? finalScore(best, normalizedObjective) : 0,
    totalDamage: best?.damage || 0,
    sequence: best?.sequence || [],
    perTurn,
    objective: normalizedObjective,
    explored
  };
}
