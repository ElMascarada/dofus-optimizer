import { BASE_CHARACTER } from './config.js';
import { addStats, constraintDeficits, effectiveStats, emptyStats } from './stats.js';
import { applySetBonuses } from './sets.js';
import {
  estimateElementValues,
  evaluateTurnConstraints,
  spellDamageBreakdown,
  statsForTurnDetailed
} from './spells.js';
import { optimizeCharacteristics } from './characteristics.js';
import { optimizeFm } from './fm.js';
import {
  characteristicMinimumsForItems,
  itemConditionsAreValid,
  permanentStatCapViolations,
  specialSlotRulesAreValid
} from './build-legality.js';

const evaluationCacheByScenario = new WeakMap();
const objectIds = new WeakMap();
let nextObjectId = 1;

function objectId(value) {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) return String(value);
  if (!objectIds.has(value)) objectIds.set(value, nextObjectId++);
  return objectIds.get(value);
}

function policyKey(policy = {}) {
  return Object.entries(policy || {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}:${JSON.stringify(value)}`)
    .join('|');
}

function evaluationKey({ items, sets, selections, constraints, fmPolicy, turnMode, character }) {
  const itemKey = (items || []).map((item) => String(item.id)).sort().join('|');
  return [
    objectId(sets),
    objectId(selections),
    objectId(constraints),
    objectId(character),
    String(turnMode),
    policyKey(fmPolicy),
    itemKey
  ].join('::');
}

function scenarioCache(scenario) {
  if (!scenario || typeof scenario !== 'object') return null;
  let cache = evaluationCacheByScenario.get(scenario);
  if (!cache) {
    cache = { entries: new Map(), hits: 0, misses: 0 };
    evaluationCacheByScenario.set(scenario, cache);
  }
  return cache;
}

function average(values = []) {
  const numbers = values.map(Number).filter(Number.isFinite);
  if (!numbers.length) return 0;
  return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
}

function buildSpellBreakdowns(selections, baseStats, items, scenario) {
  return (selections || [])
    .filter((selection) => selection?.enabled && selection?.spell && (selection.spell.hits || []).length)
    .map((selection) => {
      const spell = selection.spell;
      const perTurn = {};
      for (const turn of [1, 2, 3]) {
        const turnStats = statsForTurnDetailed(baseStats, items, turn, scenario).stats;
        perTurn[turn] = spellDamageBreakdown(spell, turnStats, turn);
      }
      const entries = Object.values(perTurn);
      return {
        id: spell.id,
        ankamaId: spell.ankamaId,
        name: spell.name,
        iconId: spell.iconId,
        apCost: spell.apCost,
        averageDamage: average(entries.map((entry) => entry.expected)),
        critChancePct: average(entries.map((entry) => entry.critChancePct)),
        normal: [
          average(entries.map((entry) => entry.normal?.[0])),
          average(entries.map((entry) => entry.normal?.[1]))
        ],
        critical: [
          average(entries.map((entry) => entry.critical?.[0])),
          average(entries.map((entry) => entry.critical?.[1]))
        ],
        perTurn
      };
    });
}

function resourceBonus(turnStats = {}, permanentStats = {}) {
  return {
    ap: Number(turnStats.ap || 0) - Number(permanentStats.ap || 0),
    mp: Number(turnStats.mp || 0) - Number(permanentStats.mp || 0)
  };
}

function evaluateCompleteBuildUncached({
  items = [],
  sets = [],
  selections = [],
  constraints = {},
  fmPolicy = {},
  turnMode = 'sum',
  character = BASE_CHARACTER,
  scenario = {}
} = {}) {
  if (!specialSlotRulesAreValid(items)) return { result: null, reason: 'structural-invalid' };

  const setsById = Object.fromEntries((sets || []).map((set) => [set.id, set]));
  const rawStats = emptyStats();
  addStats(rawStats, character.baseStats || {});
  for (const item of items) addStats(rawStats, item.stats || {});

  const statsWithSets = { ...rawStats };
  const activeSets = applySetBonuses(statsWithSets, items, setsById);
  const elementValues = estimateElementValues(selections, {});

  // Conditions are checked on final equipped stats. Scroll is free baseline;
  // only the remaining deficit should consume the 995 characteristic points.
  const conditionReference = { ...statsWithSets };
  for (const element of ['earth', 'fire', 'water', 'air']) {
    conditionReference[element] = Number(conditionReference[element] || 0) + Number(character.scrolled?.[element] || 0);
  }
  const minimumStats = characteristicMinimumsForItems(items, conditionReference, character.level);

  const charResult = optimizeCharacteristics(statsWithSets, {
    points: character.characteristicPoints,
    scrolled: character.scrolled,
    elementValues,
    minimumVitality: constraints.vit || 0,
    baseVitality: 0,
    minimumStats
  });
  if (!charResult.requirementsSatisfied) return { result: null, reason: 'item-condition' };

  // User PA/PM constraints are lower bounds, not caps. Permanent build legality
  // is enforced separately after all static equipment, set, characteristic and
  // FM effects are resolved. Dynamic turn effects are intentionally not part of
  // this gate and may raise usable combat AP above the permanent cap.
  const fm = optimizeFm({
    baseStats: charResult.stats,
    items,
    selections,
    turnMode,
    policy: fmPolicy,
    scenario
  });
  if (!fm) return { result: null, reason: 'evaluation-failed' };

  const permanentCapViolations = permanentStatCapViolations(fm.stats);
  if (permanentCapViolations.length) {
    return {
      result: null,
      reason: 'permanent-stat-cap',
      legalityDiagnostics: { permanentCapViolations }
    };
  }

  if (!itemConditionsAreValid(items, fm.stats, character.level)) {
    return { result: null, reason: 'item-condition' };
  }

  // User constraints describe the permanent stuff first. A temporary T1 bonus
  // must never be allowed to "rescue" a build that is intrinsically below the
  // requested Vitality, range or resistances. We then run the turn-aware check
  // below as a second gate so temporary penalties (e.g. PA/PM loss) can still
  // invalidate the selected turn.
  const staticConstraintDeficits = constraintDeficits(fm.stats, constraints);
  if (Object.keys(staticConstraintDeficits).length) {
    return {
      result: null,
      reason: 'constraint',
      constraintDiagnostics: {
        meets: false,
        staticConstraintDeficits
      }
    };
  }

  const turnConstraints = evaluateTurnConstraints({
    stats: fm.stats,
    items,
    constraints,
    selections,
    turnMode,
    scenario
  });

  // Constraints are hard legality rules. Do not surface a build with a warning
  // when it actually misses the user's PA/PM/PO/Vita/resistance requirements.
  if (!turnConstraints.meets) {
    return {
      result: null,
      reason: 'constraint',
      constraintDiagnostics: {
        ...turnConstraints,
        staticConstraintDeficits
      }
    };
  }

  const warnings = [];
  if (fm.objective.unresolvedPassiveContexts?.length) warnings.push('unresolved-passive');

  const effectiveStatsByTurn = {};
  const resourceBonusesByTurn = {};
  for (const turn of [1, 2, 3]) {
    // statsForTurnDetailed is resolved before any combat action is spent. Keep
    // PA/PM deltas explicitly so presentation never has to infer a temporary
    // resource bonus from rotation state such as apRemainingAfterCast.
    const detailed = statsForTurnDetailed(fm.stats, items, turn, scenario).stats;
    effectiveStatsByTurn[turn] = effectiveStats(detailed);
    resourceBonusesByTurn[turn] = resourceBonus(detailed, fm.stats);
  }
  const spellBreakdowns = buildSpellBreakdowns(selections, fm.stats, items, scenario);

  return {
    result: {
      score: fm.objective.score,
      perTurn: fm.objective.perTurn,
      items: [...items],
      stats: effectiveStats(fm.stats),
      effectiveStatsByTurn,
      resourceBonusesByTurn,
      spellBreakdowns,
      characteristics: charResult.allocation,
      characteristicRequirements: minimumStats,
      fm: {
        critItems: fm.critItems,
        spellPctItems: fm.spellPctItems,
        structuralExos: 0,
        assignments: fm.assignments
      },
      activeSets,
      warnings,
      itemConditionsSatisfied: true,
      turnFeasible: true,
      unresolvedPassiveContexts: [...new Set(fm.objective.unresolvedPassiveContexts || [])]
    },
    reason: null,
    warnings
  };
}

export function evaluateCompleteBuild(options = {}) {
  const scenario = options?.scenario;
  const cache = scenarioCache(scenario);
  if (!cache) return evaluateCompleteBuildUncached(options);

  const key = evaluationKey(options);
  if (cache.entries.has(key)) {
    cache.hits++;
    return cache.entries.get(key);
  }

  const evaluation = evaluateCompleteBuildUncached(options);
  cache.entries.set(key, evaluation);
  cache.misses++;
  return evaluation;
}

export function completeBuildEvaluationCacheStats(scenario) {
  const cache = scenario && typeof scenario === 'object' ? evaluationCacheByScenario.get(scenario) : null;
  return cache
    ? { hits: cache.hits, misses: cache.misses, entries: cache.entries.size }
    : { hits: 0, misses: 0, entries: 0 };
}
