import { optimizeCombatSequence } from '../turn-optimizer.js';
import { temporalObjectiveMetrics } from '../temporal-objectives.js';
import { getSearchProfile } from '../../optimizer/search-profiles.js';

const analysisCache = new WeakMap();

function actionsForTurn(sequence = [], turn) {
  return sequence.filter((entry) => Number(entry?.turn) === Number(turn));
}

export function analyzeWorkshopTurns(evaluation) {
  if (!evaluation || typeof evaluation !== 'object') return null;
  if (analysisCache.has(evaluation)) return analysisCache.get(evaluation);
  if (!evaluation.valid || !evaluation.complete || !(evaluation.combatSpells || []).length) {
    analysisCache.set(evaluation, null);
    return null;
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

  const turns = [1, 2, 3].map((turn) => ({
    turn,
    damage: Number(plan.perTurn?.[turn] || 0),
    startAp: Number(plan.turnStartAp?.[turn] || 0),
    actions: actionsForTurn(plan.sequence, turn)
  }));
  const analysis = {
    plan,
    turns,
    metrics: temporalObjectiveMetrics(plan.perTurn, [1, 2, 3])
  };
  analysisCache.set(evaluation, analysis);
  return analysis;
}
