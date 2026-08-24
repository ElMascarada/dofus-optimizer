import { BASE_CHARACTER } from './config.js';
import { addStats, emptyStats } from './stats.js';
import { applySetBonuses } from './sets.js';
import { estimateElementValues, evaluateTurnConstraints } from './spells.js';
import { optimizeCharacteristics } from './characteristics.js';
import { optimizeFm } from './fm.js';
import { itemConditionsAreValid, specialSlotRulesAreValid } from './build-legality.js';

function capPermanentApMp(stats, constraints = {}) {
  const capped = { ...stats };
  for (const key of ['ap', 'mp']) {
    const cap = Number(constraints?.[key] || 0);
    if (Number.isFinite(cap) && cap > 0 && Number(capped[key] || 0) > cap) capped[key] = cap;
  }
  return capped;
}

export function evaluateCompleteBuild({
  items = [],
  sets = [],
  selections = [],
  constraints = {},
  fmPolicy = {},
  turnMode = 'sum',
  character = BASE_CHARACTER,
  scenario = {}
} = {}) {
  // Structural slot legality is an invariant of the architecture generator.
  // Keep the guard as a safety net, but generated candidates should never hit it.
  if (!specialSlotRulesAreValid(items)) return { result: null, reason: 'structural-invalid' };

  const setsById = Object.fromEntries((sets || []).map((set) => [set.id, set]));
  const rawStats = emptyStats();
  addStats(rawStats, character.baseStats || {});
  for (const item of items) addStats(rawStats, item.stats || {});

  const statsWithSets = { ...rawStats };
  const activeSets = applySetBonuses(statsWithSets, items, setsById);
  const elementValues = estimateElementValues(selections, {});
  const charResult = optimizeCharacteristics(statsWithSets, {
    points: character.characteristicPoints,
    scrolled: character.scrolled,
    elementValues,
    minimumVitality: constraints.vit || 0,
    baseVitality: 0
  });

  // The architecture search already guarantees the permanent 12/6 target.
  // If an equipment combination naturally exceeds it, cap the permanent display
  // at 12/6; temporary combat effects are still applied afterwards and may exceed it.
  const permanentBase = capPermanentApMp(charResult.stats, constraints);
  const fm = optimizeFm({
    baseStats: permanentBase,
    items,
    selections,
    turnMode,
    policy: fmPolicy,
    scenario
  });
  if (!fm) return { result: null, reason: 'evaluation-failed' };

  // IMPORTANT: these checks are diagnostic only. They must never remove an
  // architecture from damage comparison. We compare every generated 12/6 build.
  const itemConditionsSatisfied = itemConditionsAreValid(items, fm.stats, character.level);
  const turnConstraints = evaluateTurnConstraints({
    stats: fm.stats,
    items,
    constraints,
    selections,
    turnMode,
    scenario
  });

  const warnings = [];
  if (!itemConditionsSatisfied) warnings.push('item-condition');
  if (fm.objective.unresolvedPassiveContexts?.length || turnConstraints.unresolvedPassiveContexts?.length) {
    warnings.push('unresolved-passive');
  }
  if (Object.keys(turnConstraints.baseApMpMismatches || {}).length) warnings.push('base-ap-mp');
  if (Object.keys(turnConstraints.deficitsByTurn || {}).length) warnings.push('turn-constraints');

  return {
    result: {
      score: fm.objective.score,
      perTurn: fm.objective.perTurn,
      items: [...items],
      stats: fm.stats,
      effectiveStatsByTurn: turnConstraints.perTurn,
      characteristics: charResult.allocation,
      fm: {
        critItems: fm.critItems,
        spellPctItems: fm.spellPctItems,
        structuralExos: 0,
        assignments: fm.assignments
      },
      activeSets,
      warnings,
      itemConditionsSatisfied,
      turnFeasible: turnConstraints.meets,
      unresolvedPassiveContexts: [
        ...new Set([
          ...(fm.objective.unresolvedPassiveContexts || []),
          ...(turnConstraints.unresolvedPassiveContexts || [])
        ])
      ]
    },
    reason: null,
    warnings
  };
}
