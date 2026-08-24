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
        casts: {
          1: Math.max(0, Number(selection.casts?.[1] || 0)),
          2: Math.max(0, Number(selection.casts?.[2] || 0)),
          3: Math.max(0, Number(selection.casts?.[3] || 0))
        },
        weight: Math.max(0, Number(selection.weight ?? 1)),
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

function buildRequestedTurnPlan(selections, spellBreakdowns, perTurn = {}, effectiveStatsByTurn = {}) {
  const breakdownById = new Map((spellBreakdowns || []).map((entry) => [String(entry.id), entry]));
  const activeTurns = Object.keys(perTurn).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  const sequence = [];

  for (const turn of activeTurns) {
    for (const selection of selections || []) {
      if (!selection?.enabled || !selection?.spell || !(selection.spell.hits || []).length) continue;
      const casts = Math.max(0, Number(selection.casts?.[turn] || 0));
      if (!casts) continue;
      const spell = selection.spell;
      const breakdown = breakdownById.get(String(spell.id));
      const perCast = Math.max(0, Number(breakdown?.perTurn?.[turn]?.expected || 0));
      const weight = Math.max(0, Number(selection.weight ?? 1));
      for (let cast = 0; cast < casts; cast++) {
        sequence.push({
          turn,
          spellId: spell.id,
          ankamaId: spell.ankamaId,
          name: spell.name,
          iconId: spell.iconId,
          apCost: Math.max(0, Number(spell.apCost || 0)),
          expectedDamage: perCast * weight,
          rawExpectedDamage: perCast,
          weight,
          castNumber: cast + 1,
          appliedModifiers: []
        });
      }
    }
  }

  return {
    kind: 'requested-combo',
    objective: {
      mode: 'manual',
      activeTurns,
      targetMode: 'single',
      areaTargets: 1
    },
    sequence,
    perTurn: { ...perTurn },
    totalDamage: activeTurns.reduce((sum, turn) => sum + Number(perTurn?.[turn] || 0), 0),
    availableApByTurn: Object.fromEntries(activeTurns.map((turn) => [turn, Number(effectiveStatsByTurn?.[turn]?.ap || 0)]))
  };
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

  const turnConstraints = evaluateTurnConstraints({
    stats: fm.stats,
    items,
    constraints,
    selections,
    turnMode,
    scenario
  });

  // A displayed score must correspond to a turn the character can actually
  // execute. Previously we kept impossible builds and only attached a
  // `turn-constraints` warning, which could rank a 15+ PA combo on a 12 PA
  // build. Reject it instead; temporary PA from Prysmaradites is already
  // included in `turnConstraints`, so legal burst turns still pass.
  if (!turnConstraints.meets) {
    const unresolved = turnConstraints.unresolvedPassiveContexts?.length > 0;
    return {
      result: null,
      reason: unresolved ? 'unresolved-passive' : 'turn-constraints',
      warnings: unresolved ? ['unresolved-passive'] : ['turn-constraints']
    };
  }

  const effectiveStatsByTurn = {};
  for (const turn of [1, 2, 3]) effectiveStatsByTurn[turn] = statsForTurnDetailed(fm.stats, items, turn, scenario).stats;
  const spellBreakdowns = buildSpellBreakdowns(selections, fm.stats, items, scenario);
  const combatPlan = buildRequestedTurnPlan(selections, spellBreakdowns, fm.objective.perTurn, effectiveStatsByTurn);

  return {
    result: {
      score: fm.objective.score,
      perTurn: fm.objective.perTurn,
      items: [...items],
      stats: fm.stats,
      effectiveStatsByTurn,
      spellBreakdowns,
      combatPlan,
      characteristics: charResult.allocation,
      characteristicRequirements: minimumStats,
      fm: {
        critItems: fm.critItems,
        spellPctItems: fm.spellPctItems,
        structuralExos: 0,
        assignments: fm.assignments
      },
      activeSets,
      warnings: [],
      itemConditionsSatisfied: true,
      turnFeasible: true,
      unresolvedPassiveContexts: []
    },
    reason: null,
    warnings: []
  };
}
