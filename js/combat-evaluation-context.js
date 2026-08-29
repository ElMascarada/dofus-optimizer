import { optimizeCombatSequence } from './turn-optimizer.js';
import { getSearchProfile } from '../optimizer/search-profiles.js';

export const CANONICAL_T1_CONTEXT_VERSION = 1;
export const CANONICAL_T1_INITIAL_STATE = 'default-empty';

function cloneStats(stats = {}) {
  return { ...(stats || {}) };
}

function cloneScenario(scenario = {}) {
  return {
    ...(scenario || {}),
    requiredApByTurn: { ...(scenario?.requiredApByTurn || {}) }
  };
}

function normalizeSpellIds(spellIds = []) {
  return [...new Set((spellIds || []).map(String).filter(Boolean))];
}

function normalizeObjective(objective = {}) {
  return {
    ...(objective || {}),
    turnMode: 't1',
    targetMode: objective?.targetMode === 'zone' ? 'zone' : 'single',
    areaTargets: Math.max(1, Number(objective?.areaTargets || 3)),
    allowSupport: objective?.allowSupport !== false,
    metric: objective?.metric === 'damage-per-ap' ? 'damage-per-ap' : 'total-damage'
  };
}

export function createCanonicalT1CombatContext({
  classId = null,
  element = null,
  combatObjective = {},
  scenario = {},
  spellIds = [],
  stats = {},
  effectiveStatsByTurn = {},
  fm = null,
  searchProfile = 'BALANCED'
} = {}) {
  const t1Stats = effectiveStatsByTurn?.[1] || effectiveStatsByTurn?.['1'] || stats || {};
  return {
    version: CANONICAL_T1_CONTEXT_VERSION,
    classId: classId == null ? null : String(classId),
    element: element == null ? null : String(element),
    turnMode: 't1',
    combatObjective: normalizeObjective(combatObjective),
    scenario: cloneScenario(scenario),
    spellIds: normalizeSpellIds(spellIds),
    stats: cloneStats(stats),
    effectiveStatsByTurn: { 1: cloneStats(t1Stats) },
    fm: fm ? { ...fm } : null,
    searchProfile: String(searchProfile || 'BALANCED').toUpperCase(),
    initialCombatState: CANONICAL_T1_INITIAL_STATE
  };
}

export function canonicalT1ContextIsUsable(context = {}) {
  return Number(context?.version) === CANONICAL_T1_CONTEXT_VERSION
    && context?.turnMode === 't1'
    && context?.combatObjective?.turnMode === 't1'
    && context?.initialCombatState === CANONICAL_T1_INITIAL_STATE
    && Array.isArray(context?.spellIds)
    && context.spellIds.length > 0
    && context?.effectiveStatsByTurn?.[1];
}

export function spellsForCanonicalT1Context(context = {}, spellData = {}) {
  if (!canonicalT1ContextIsUsable(context)) return [];
  const byId = new Map((spellData?.spells || []).map((spell) => [String(spell?.id), spell]));
  const spells = context.spellIds.map((id) => byId.get(String(id))).filter(Boolean);
  return spells.length === context.spellIds.length ? spells : [];
}

export function evaluateCanonicalT1Combat({ context, spells = [] } = {}) {
  if (!canonicalT1ContextIsUsable(context)) {
    throw new Error('Contexte combat T1 canonique invalide.');
  }
  if (spells.length !== context.spellIds.length) {
    throw new Error('Pool de sorts T1 canonique incomplet.');
  }
  const combatBudget = getSearchProfile(context.searchProfile).combat;
  return optimizeCombatSequence({
    baseStats: context.stats || {},
    baseStatsByTurn: context.effectiveStatsByTurn || null,
    spells,
    objective: context.combatObjective,
    beamWidth: combatBudget.singleTurnBeamWidth,
    interTurnWidth: combatBudget.singleTurnInterTurnWidth,
    maxActionsPerTurn: combatBudget.maxActionsPerTurn
  });
}
