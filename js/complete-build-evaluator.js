import { BASE_CHARACTER } from './config.js';
import { addStats, constraintDeficits, emptyStats } from './stats.js';
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

  // PA/PM constraints are minimums, never caps. A 12/6 build remains 12/6 when
  // the user asks for 11/5, so its extra resources are still valued by rotations.
  const fm = optimizeFm({
    baseStats: charResult.stats,
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

  // User constraints describe the permanent stuff shown in the result card.
  // Temporary T1/T2/T3 passives may improve those values for combat, but they
  // must never rescue a build whose displayed Vita/PO/resistances are below the
  // requested minimums. We still run the per-turn validation afterwards so a
  // temporary penalty (for example PA/PM loss) can invalidate the relevant turn.
  const permanentDeficits = constraintDeficits(fm.stats, constraints);
  if (Object.keys(permanentDeficits).length) {
    return {
      result: null,
      reason: 'constraint',
      constraintDiagnostics: {
        permanentDeficits,
        permanentStats: { ...fm.stats }
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
      constraintDiagnostics: turnConstraints
    };
  }

  const warnings = [];
  if (fm.objective.unresolvedPassiveContexts?.length) warnings.push('unresolved-passive');

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
