import { evaluateTurnConstraints, selectedTurnsForMode } from './spells.js';

export function buildConstraintDiagnostics(build, {
  constraints = {},
  selections = [],
  turnMode = 'sum',
  scenario = {}
} = {}) {
  if (!build?.items?.length || !build?.stats) {
    return {
      meets: false,
      deficitsByTurn: {},
      baseApMpMismatches: {},
      requiredApByTurn: {},
      unresolvedPassiveContexts: [],
      reason: 'missing-build-data'
    };
  }

  return evaluateTurnConstraints({
    stats: build.stats,
    items: build.items,
    constraints,
    selections,
    turnMode,
    scenario
  });
}

export function buildMeetsHardConstraints(build, options = {}) {
  return buildConstraintDiagnostics(build, options).meets === true;
}

export function keepHardValidBuilds(builds = [], options = {}) {
  return (builds || []).filter((build) => buildMeetsHardConstraints(build, options));
}

export function combatPlanIsComplete(build, turnMode = 't1') {
  const plan = build?.combatPlan;
  if (!plan || !plan.perTurn || !plan.objective) return false;

  const expectedTurns = selectedTurnsForMode(turnMode);
  const activeTurns = Array.isArray(plan.objective.activeTurns)
    ? plan.objective.activeTurns.map(Number)
    : [];

  return expectedTurns.every((turn) =>
    activeTurns.includes(turn)
    && Object.prototype.hasOwnProperty.call(plan.perTurn, turn)
    && Number.isFinite(Number(plan.perTurn[turn]))
  );
}

export function keepCompleteCombatPlans(builds = [], turnMode = 't1') {
  return (builds || []).filter((build) => combatPlanIsComplete(build, turnMode));
}
