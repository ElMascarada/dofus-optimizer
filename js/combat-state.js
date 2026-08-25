import { addStats, cloneStats } from './stats.js';

function finiteStats(stats = {}) {
  const result = {};
  for (const [key, value] of Object.entries(stats || {})) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric !== 0) result[key] = numeric;
  }
  return result;
}

function retainedModifiersFromTurn(modifiers = [], turn = 1) {
  const current = Math.max(1, Number(turn || 1));
  return (modifiers || []).filter((modifier) => Number(modifier.expiresAfterTurn || 0) >= current);
}

export function normalizeTimedModifier(modifier = {}, sourceSpellId = 'unknown', turn = 1) {
  const durationTurns = Math.max(1, Number(modifier.durationTurns || modifier.duration || 1));
  const delayTurns = Math.max(0, Number(modifier.delayTurns || 0));
  const castTurn = Math.max(1, Number(turn || 1));
  const appliedTurn = castTurn + delayTurns;
  return {
    id: String(modifier.id || `${sourceSpellId}:${modifier.scope || 'self'}:${Object.keys(modifier.stats || {}).sort().join(',')}`),
    sourceSpellId: String(sourceSpellId),
    scope: modifier.scope === 'target' ? 'target' : 'self',
    stats: finiteStats(modifier.stats),
    appliedTurn,
    expiresAfterTurn: appliedTurn + durationTurns - 1,
    stacking: modifier.stacking || 'replace-source'
  };
}

export function activeModifiersForTurn(modifiers = [], turn = 1, scope = null) {
  const current = Math.max(1, Number(turn || 1));
  return retainedModifiersFromTurn(modifiers, current).filter((modifier) =>
    Number(modifier.appliedTurn || 1) <= current
    && (!scope || modifier.scope === scope)
  );
}

export function statsWithCombatModifiers(baseStats = {}, modifiers = [], turn = 1, scope = 'self') {
  const stats = cloneStats(baseStats);
  for (const modifier of activeModifiersForTurn(modifiers, turn, scope)) addStats(stats, modifier.stats || {});
  return stats;
}

export function applyTimedModifiers(modifiers = [], incoming = [], sourceSpellId = 'unknown', turn = 1) {
  let next = retainedModifiersFromTurn(modifiers, turn).map((modifier) => ({ ...modifier, stats: { ...(modifier.stats || {}) } }));
  for (const raw of incoming || []) {
    const modifier = normalizeTimedModifier(raw, sourceSpellId, turn);
    if (!Object.keys(modifier.stats).length) continue;
    if (modifier.stacking === 'replace-source') {
      next = next.filter((entry) => !(entry.sourceSpellId === modifier.sourceSpellId && entry.id === modifier.id));
    }
    next.push(modifier);
  }
  return next;
}

export function expireCombatModifiers(modifiers = [], nextTurn = 1) {
  return retainedModifiersFromTurn(modifiers, nextTurn).map((modifier) => ({ ...modifier, stats: { ...(modifier.stats || {}) } }));
}

function modifierSignature(modifier) {
  const stats = Object.entries(modifier.stats || {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}:${Number(value)}`)
    .join(',');
  return `${modifier.scope}:${modifier.id}:${modifier.appliedTurn}:${modifier.expiresAfterTurn}:${stats}`;
}

// The search-state signature deliberately keeps scheduled modifiers too. Two
// otherwise identical states are not equivalent if one of them already owes a
// delayed penalty (for example Iop's Précipitation on the next turn).
export function combatModifierSignature(modifiers = [], turn = 1) {
  return retainedModifiersFromTurn(modifiers, turn)
    .map(modifierSignature)
    .sort()
    .join('|');
}
