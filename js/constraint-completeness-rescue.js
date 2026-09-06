import {
  emptyConstraintRescueDiagnostics as legacyEmptyDiagnostics,
  searchConstraintCompletenessRescue as searchLegacyConstraintCompletenessRescue,
  shouldUseConstraintCompletenessRescue
} from './constraint-completeness-rescue-legacy.js';
import { searchCombatT1ConstraintRescue } from './constraint-completeness-combat-t1.js';

export { shouldUseConstraintCompletenessRescue };

export function emptyConstraintRescueDiagnostics() {
  return {
    ...legacyEmptyDiagnostics(),
    constraintRescueFirstIncumbentScore: null,
    constraintRescueFinalIncumbentScore: null,
    constraintRescueCombatBoundCalls: 0,
    constraintRescueCombatBoundPruned: 0,
    constraintRescueEquipmentStructures: 0,
    constraintRescueEquipmentStructuresAtFirstIncumbent: null,
    constraintRescueParetoComparable: 0,
    constraintRescueParetoDominated: 0,
    constraintRescueParetoFrontier: 0,
    constraintRescueParetoOpaqueKept: 0,
    constraintRescueCompanionExpansions: 0,
    constraintRescueDofusExpansions: 0
  };
}

export function searchConstraintCompletenessRescue(options = {}) {
  const guidedT1 = String(options?.turnMode || '') === 't1'
    && options?.explorationGuidance !== 'legacy';
  if (guidedT1) return searchCombatT1ConstraintRescue(options);
  return searchLegacyConstraintCompletenessRescue(options);
}
