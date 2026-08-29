import { optimizeCombatSequence } from '../turn-optimizer.js';
import { temporalObjectiveMetrics } from '../temporal-objectives.js';
import { getSearchProfile } from '../../optimizer/search-profiles.js';

const analysisCache = new WeakMap();

function actionsForTurn(sequence = [], turn) {
  return sequence.filter((entry) => Number(entry?.turn) === Number(turn));
}

function analysisFromPlan(plan, turns) {
  const turnRows = turns.map((turn) => ({
    turn,
    damage: Number(plan.perTurn?.[turn] || 0),
    startAp: Number(plan.turnStartAp?.[turn] || 0),
    actions: actionsForTurn(plan.sequence, turn)
  }));
  return {
    plan,
    turns: turnRows,
    metrics: temporalObjectiveMetrics(plan.perTurn, turns)
  };
}

export function analyzeWorkshopTurns(evaluation) {
  if (!evaluation || typeof evaluation !== 'object') return null;
  if (analysisCache.has(evaluation)) return analysisCache.get(evaluation);
  if (!evaluation.valid || !evaluation.complete || !(evaluation.combatSpells || []).length) {
    analysisCache.set(evaluation, null);
    return null;
  }

  if (evaluation.canonicalCombatContext?.turnMode === 't1') {
    const analysis = analysisFromPlan(evaluation.canonicalCombatContext.plan, [1]);
    analysisCache.set(evaluation, analysis);
    return analysis;
  }

  const combatBudget = getSearchProfile('BALANCED').combat;
  const plan = optimizeCombatSequence({
    baseStats: evaluation.stats || {},
    baseStatsByTurn: evaluation.effectiveStatsByTurn || null,
    spells: evaluation.combatSpells,
    objective: {
      turnMode: 'sum',
      targetMode: 'single',
      areaTargets: 3,
      allowSupport: true,
      metric: 'total-damage'
    },
    beamWidth: combatBudget.preciseBeamWidth,
    interTurnWidth: combatBudget.preciseInterTurnWidth,
    maxActionsPerTurn: combatBudget.maxActionsPerTurn
  });

  const analysis = analysisFromPlan(plan, [1, 2, 3]);
  analysisCache.set(evaluation, analysis);
  return analysis;
}
