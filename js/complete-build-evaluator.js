import { BASE_CHARACTER } from './config.js';
import { addStats, emptyStats } from './stats.js';
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
  specialSlotRulesAreValid
} from './build-legality.js';

function capPermanentApMp(stats, constraints = {}) {
  const capped = { ...stats };
  for (const key of ['ap', 'mp']) {
    const cap = Number(constraints?.[key] || 0);
    if (Number.isFinite(cap) && cap > 0 && Number(capped[key] || 0) > cap) capped[key] = cap;
  }
  return capped;
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
        weight: Number(selection.weight ?? 1),
        casts: {
          1: Math.max(0, Number(selection.casts?.[1] || 0)),
          2: Math.max(0, Number(selection.casts?.[2] || 0)),
          3: Math.max(0, Number(selection.casts?.[3] || 0))
        },
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

function hasExplicitTurnPlan(scenario = {}) {
  return Object.values(scenario?.requiredApByTurn || {}).some((value) => Number(value || 0) > 0);
}

function buildRequestedTurnPlan(spellBreakdowns = [], turnMode = 'sum') {
  const activeTurns = turnMode === 't1' ? [1]
    : turnMode === 't2' ? [2]
      : turnMode === 't3' ? [3]
        : [1, 2, 3];
  const perTurn = {};

  for (const turn of activeTurns) {
    const actions = spellBreakdowns
      .map((spell) => {
        const casts = Math.max(0, Number(spell.casts?.[turn] || 0));
        if (!casts) return null;
        const expectedPerCast = Number(spell.perTurn?.[turn]?.expected || 0);
        const weight = Math.max(0, Number(spell.weight ?? 1));
        return {
          id: spell.id,
          ankamaId: spell.ankamaId,
          iconId: spell.iconId,
          name: spell.name,
          casts,
          apCost: Number(spell.apCost || 0),
          apSpent: casts * Number(spell.apCost || 0),
          expectedPerCast,
          expectedDamage: expectedPerCast * casts,
          weight,
          objectiveContribution: expectedPerCast * casts * weight
        };
      })
      .filter(Boolean);

    perTurn[turn] = {
      actions,
      apSpent: actions.reduce((sum, action) => sum + action.apSpent, 0),
      expectedDamage: actions.reduce((sum, action) => sum + action.expectedDamage, 0),
      objectiveScore: actions.reduce((sum, action) => sum + action.objectiveContribution, 0)
    };
  }

  return { activeTurns, perTurn };
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

  if (!itemConditionsAreValid(items, fm.stats, character.level)) {
    return { result: null, reason: 'item-condition' };
  }

  // In automatic combat mode the preselection deliberately marks many spells as
  // enabled at once. Those synthetic casts are a scoring probe, not a sequence the
  // player is expected to cast. Only an explicit UI turn plan should consume PA
  // here; the real combat sequence solver enforces PA again action by action later.
  const explicitTurnPlan = hasExplicitTurnPlan(scenario);
  const turnConstraints = evaluateTurnConstraints({
    stats: fm.stats,
    items,
    constraints,
    selections: explicitTurnPlan ? selections : [],
    turnMode,
    scenario
  });

  const hardTurnFailure = Object.keys(turnConstraints.baseApMpMismatches || {}).length > 0
    || Object.keys(turnConstraints.deficitsByTurn || {}).length > 0;
  if (explicitTurnPlan && hardTurnFailure) {
    return { result: null, reason: 'turn-constraints', turnConstraints };
  }

  const warnings = [];
  if (fm.objective.unresolvedPassiveContexts?.length || turnConstraints.unresolvedPassiveContexts?.length) {
    warnings.push('unresolved-passive');
  }
  if (Object.keys(turnConstraints.baseApMpMismatches || {}).length) warnings.push('base-ap-mp');
  if (Object.keys(turnConstraints.deficitsByTurn || {}).length) warnings.push('turn-constraints');

  const effectiveStatsByTurn = {};
  for (const turn of [1, 2, 3]) effectiveStatsByTurn[turn] = statsForTurnDetailed(fm.stats, items, turn, scenario).stats;
  const spellBreakdowns = buildSpellBreakdowns(selections, fm.stats, items, scenario);

  return {
    result: {
      score: fm.objective.score,
      perTurn: fm.objective.perTurn,
      items: [...items],
      stats: fm.stats,
      effectiveStatsByTurn,
      spellBreakdowns,
      requestedTurnPlan: explicitTurnPlan ? buildRequestedTurnPlan(spellBreakdowns, turnMode) : null,
      objectiveMode: explicitTurnPlan ? 'manual' : 'combat',
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
      turnFeasible: turnConstraints.meets,
      turnConstraints,
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
