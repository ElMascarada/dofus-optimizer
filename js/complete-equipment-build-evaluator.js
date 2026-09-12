import { BASE_CHARACTER } from './config.js';
import { addStats, constraintDeficits, effectiveStat, effectiveStats, emptyStats } from './stats.js';
import { applySetBonuses } from './sets.js';
import {
  characteristicMinimumsForItems,
  completeSlotStructureIsValid,
  itemConditionsAreValid,
  permanentStatCapViolations,
  specialSlotRulesAreValid
} from './build-legality.js';
import { statsWithStructuralExos } from './structural-exos.js';
import { optimizeSyntheticCharacteristicsTwoElementLinear as optimizeSyntheticCharacteristics } from './synthetic-characteristics-two-element-linear.js';
import { optimizeSyntheticFm, syntheticFmEnabled } from './synthetic-fm.js';

const ELEMENTS = Object.freeze(['earth', 'fire', 'water', 'air']);

function setsByIdFor(sets = []) {
  return Object.fromEntries((sets || []).map((set) => [set.id, set]));
}

export function completeEquipmentBuildIdentity(items = []) {
  return (items || []).map((item) => String(item?.id ?? '')).sort().join('|');
}

export function compareCompleteEquipmentBuildResults(left, right) {
  const leftOffense = left?.syntheticOffense || left?.result?.syntheticOffense;
  const rightOffense = right?.syntheticOffense || right?.result?.syntheticOffense;
  const minimumDelta = Number(leftOffense?.minimumScore || 0) - Number(rightOffense?.minimumScore || 0);
  if (minimumDelta !== 0) return minimumDelta;
  const meanDelta = Number(leftOffense?.meanScore || 0) - Number(rightOffense?.meanScore || 0);
  if (meanDelta !== 0) return meanDelta;
  const leftIdentity = String(left?.buildIdentity || left?.result?.buildIdentity || '');
  const rightIdentity = String(right?.buildIdentity || right?.result?.buildIdentity || '');
  return rightIdentity.localeCompare(leftIdentity);
}

function conditionReferenceStats(stats, scrolled = {}) {
  const reference = { ...stats };
  for (const element of ELEMENTS) reference[element] = Number(reference[element] || 0) + Number(scrolled?.[element] || 0);
  return reference;
}

export function evaluateCompleteEquipmentBuild({
  items = [],
  sets = [],
  constraints = {},
  fmPolicy = {},
  syntheticOffense = {},
  character = BASE_CHARACTER
} = {}) {
  if (!completeSlotStructureIsValid(items) || !specialSlotRulesAreValid(items)) {
    return { result: null, reason: 'structural-invalid' };
  }

  const rawStats = emptyStats();
  addStats(rawStats, character?.baseStats || {});
  for (const item of items || []) addStats(rawStats, item?.stats || {});

  const statsWithSets = { ...rawStats };
  const activeSets = applySetBonuses(statsWithSets, items, setsByIdFor(sets));
  const structural = statsWithStructuralExos(statsWithSets, fmPolicy);

  const preCharacteristicCaps = permanentStatCapViolations(structural.stats, { includeMp: true });
  if (preCharacteristicCaps.length) {
    return {
      result: null,
      reason: 'permanent-stat-cap',
      legalityDiagnostics: { permanentCapViolations: preCharacteristicCaps }
    };
  }

  const conditionReference = conditionReferenceStats(structural.stats, character?.scrolled);
  const minimumStats = characteristicMinimumsForItems(items, conditionReference, character?.level);
  const actualPermanentAp = effectiveStat(structural.stats, 'ap');
  const critMode = syntheticOffense?.critMode || 'auto';

  let characteristics;
  try {
    characteristics = optimizeSyntheticCharacteristics({
      baseStats: structural.stats,
      points: character?.characteristicPoints,
      scrolled: character?.scrolled,
      constraints,
      minimumStats,
      availableAp: actualPermanentAp,
      elements: syntheticOffense?.elements,
      profiles: syntheticOffense?.profiles,
      critMode
    });
  } catch (error) {
    return {
      result: null,
      reason: 'evaluation-failed',
      evaluationDiagnostics: { message: error instanceof Error ? error.message : String(error) }
    };
  }

  if (!characteristics?.feasible) {
    return { result: null, reason: characteristics?.reason || 'constraint' };
  }

  let fm;
  try {
    fm = optimizeSyntheticFm({
      stats: characteristics.stats,
      items,
      availableAp: actualPermanentAp,
      elements: syntheticOffense?.elements,
      profiles: syntheticOffense?.profiles,
      critMode,
      policy: fmPolicy
    });
  } catch (error) {
    return {
      result: null,
      reason: 'evaluation-failed',
      evaluationDiagnostics: { message: error instanceof Error ? error.message : String(error) }
    };
  }

  const finalRawStats = fm.stats;
  const permanentCapViolations = permanentStatCapViolations(finalRawStats, { includeMp: true });
  if (permanentCapViolations.length) {
    return {
      result: null,
      reason: 'permanent-stat-cap',
      legalityDiagnostics: { permanentCapViolations }
    };
  }

  if (!itemConditionsAreValid(items, finalRawStats, character?.level)) {
    return { result: null, reason: 'item-condition' };
  }

  const staticConstraintDeficits = constraintDeficits(finalRawStats, constraints);
  if (Object.keys(staticConstraintDeficits).length) {
    return {
      result: null,
      reason: 'constraint',
      constraintDiagnostics: { meets: false, staticConstraintDeficits }
    };
  }

  const permanentStats = effectiveStats(finalRawStats);
  const syntheticResult = fm.offense;
  const buildIdentity = completeEquipmentBuildIdentity(items);
  const enabled = syntheticFmEnabled(fmPolicy);
  return {
    result: {
      score: syntheticResult.minimumScore,
      items: [...items],
      stats: permanentStats,
      activeSets,
      characteristics: characteristics.allocation,
      characteristicRequirements: minimumStats,
      structuralExos: {
        exoAp: structural.exoAp,
        exoMp: structural.exoMp,
        count: structural.structuralExos
      },
      fm: {
        enabled,
        exoAp: structural.exoAp,
        exoMp: structural.exoMp,
        structuralSlots: fm.structuralSlots,
        offensiveSlots: fm.offensiveSlots,
        spellPctItems: fm.spellPctItems,
        critItems: fm.critItems,
        assignments: fm.assignments,
        legacyOffensiveFmApplied: false
      },
      itemConditionsSatisfied: true,
      constraintsSatisfied: true,
      syntheticOffense: syntheticResult,
      syntheticApBudget: actualPermanentAp,
      buildIdentity,
      rankingTuple: [syntheticResult.minimumScore, syntheticResult.meanScore, buildIdentity]
    },
    reason: null
  };
}
