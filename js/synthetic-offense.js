import { stat } from './stats.js';

const ELEMENTS = Object.freeze(['earth', 'fire', 'water', 'air']);
const ELEMENT_ORDER = Object.freeze([...ELEMENTS, 'multi']);
const PROFILE_ORDER = Object.freeze(['small', 'medium', 'large']);
const ELEMENTAL_FLAT_DAMAGE_STAT = Object.freeze({
  earth: 'damageEarth',
  fire: 'damageFire',
  water: 'damageWater',
  air: 'damageAir'
});

export const SYNTHETIC_OFFENSE_PROFILES = Object.freeze({
  small: Object.freeze({ nominalAp: 2, monoBase: 20, multiLineBase: 5, baseCritChancePct: 15 }),
  medium: Object.freeze({ nominalAp: 3, monoBase: 30, multiLineBase: 7.5, baseCritChancePct: 20 }),
  large: Object.freeze({ nominalAp: 4, monoBase: 40, multiLineBase: 10, baseCritChancePct: 25 })
});

function finiteNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`${label} must be a finite number`);
  return number;
}

function normalizeSelection(value, label) {
  const list = Array.isArray(value) ? value : value == null ? [] : [value];
  const normalized = [...new Set(list.map((entry) => String(entry).trim().toLowerCase()).filter(Boolean))];
  if (!normalized.length) throw new RangeError(`${label} must contain at least one selection`);
  return normalized;
}

function normalizeElements(value) {
  const elements = normalizeSelection(value, 'elements');
  for (const element of elements) {
    if (!ELEMENT_ORDER.includes(element)) throw new RangeError(`Unsupported synthetic offense element: ${element}`);
  }
  if (elements.includes('multi')) {
    if (elements.length !== 1) throw new RangeError('multi is exclusive and cannot be combined with mono elements');
    return ['multi'];
  }
  if (elements.length > 3) throw new RangeError('At most three mono elements may be selected');
  return [...elements].sort((a, b) => ELEMENT_ORDER.indexOf(a) - ELEMENT_ORDER.indexOf(b));
}

function normalizeProfiles(value) {
  const profiles = normalizeSelection(value, 'profiles');
  for (const profile of profiles) {
    if (!PROFILE_ORDER.includes(profile)) throw new RangeError(`Unsupported synthetic offense profile: ${profile}`);
  }
  return [...profiles].sort((a, b) => PROFILE_ORDER.indexOf(a) - PROFILE_ORDER.indexOf(b));
}

function effectiveCritChancePct(stats, profile) {
  return Math.max(0, Math.min(100, profile.baseCritChancePct + stat(stats, 'crit')));
}

function evaluateLine(stats, element, normalBase, criticalBase, critProbability) {
  const characteristic = stat(stats, element) + stat(stats, 'power');
  const genericFlatDamage = stat(stats, 'damage');
  const elementalFlatDamage = stat(stats, ELEMENTAL_FLAT_DAMAGE_STAT[element]);
  const criticalDamage = stat(stats, 'critDamage');
  const normalValue = normalBase * (1 + characteristic / 100) + genericFlatDamage + elementalFlatDamage;
  const criticalValue = criticalBase * (1 + characteristic / 100) + genericFlatDamage + elementalFlatDamage + criticalDamage;
  const expectedValue = normalValue * (1 - critProbability) + criticalValue * critProbability;
  return {
    element,
    normalBase,
    criticalBase,
    characteristic,
    genericFlatDamage,
    elementalFlatDamage,
    criticalDamage,
    normalValue,
    criticalValue,
    expectedValue
  };
}

function probeLines(mode, profile) {
  if (mode === 'multi') {
    return ELEMENTS.map((element) => ({ element, normalBase: profile.multiLineBase }));
  }
  return [{ element: mode, normalBase: profile.monoBase }];
}

function evaluateProbe(stats, availableAp, mode, profileName) {
  const profile = SYNTHETIC_OFFENSE_PROFILES[profileName];
  const effectiveCritPct = effectiveCritChancePct(stats, profile);
  const critProbability = effectiveCritPct / 100;
  const lines = probeLines(mode, profile).map(({ element, normalBase }) => {
    return evaluateLine(stats, element, normalBase, normalBase * 1.25, critProbability);
  });
  const normalFullProbeValue = lines.reduce((sum, line) => sum + line.normalValue, 0);
  const criticalFullProbeValue = lines.reduce((sum, line) => sum + line.criticalValue, 0);
  const expectedFullProbeValue = lines.reduce((sum, line) => sum + line.expectedValue, 0);
  const fullCount = Math.floor(availableAp / profile.nominalAp);
  const remainderAp = availableAp % profile.nominalAp;
  const partialFactor = remainderAp / profile.nominalAp;
  const equivalentProbeCount = fullCount + partialFactor;
  const totalApBudgetScore = expectedFullProbeValue * equivalentProbeCount;

  return {
    element: mode,
    profile: profileName,
    nominalAp: profile.nominalAp,
    baseCritChancePct: profile.baseCritChancePct,
    effectiveCritChancePct: effectiveCritPct,
    effectiveCritProbability: critProbability,
    normalFullProbeValue,
    criticalFullProbeValue,
    expectedFullProbeValue,
    fullCount,
    remainderAp,
    partialFactor,
    equivalentProbeCount,
    totalApBudgetScore,
    lines
  };
}

function canonicalStatsKey(stats = {}) {
  return Object.entries(stats)
    .filter(([, value]) => Number.isFinite(Number(value)) && Number(value) !== 0)
    .map(([key, value]) => [key, Number(value)])
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}:${value}`)
    .join('|');
}

export function evaluateSyntheticOffense({ stats = {}, availableAp, elements, profiles } = {}) {
  const ap = finiteNumber(availableAp, 'availableAp');
  if (ap < 0) throw new RangeError('availableAp must be non-negative');
  const requestedElements = normalizeElements(elements);
  const requestedProfiles = normalizeProfiles(profiles);
  const requestedProbes = [];
  for (const element of requestedElements) {
    for (const profile of requestedProfiles) requestedProbes.push(evaluateProbe(stats, ap, element, profile));
  }
  const scores = requestedProbes.map((probe) => probe.totalApBudgetScore);
  const minimumScore = Math.min(...scores);
  const meanScore = scores.reduce((sum, score) => sum + score, 0) / scores.length;
  const canonicalTieBreak = canonicalStatsKey(stats);
  return {
    availableAp: ap,
    elements: requestedElements,
    profiles: requestedProfiles,
    requestedProbes,
    minimumScore,
    meanScore,
    rankingTuple: [minimumScore, meanScore, canonicalTieBreak],
    canonicalTieBreak
  };
}

export function compareSyntheticOffenseResults(left, right) {
  const minDelta = Number(left?.minimumScore || 0) - Number(right?.minimumScore || 0);
  if (minDelta !== 0) return minDelta;
  const meanDelta = Number(left?.meanScore || 0) - Number(right?.meanScore || 0);
  if (meanDelta !== 0) return meanDelta;
  return String(right?.canonicalTieBreak || '').localeCompare(String(left?.canonicalTieBreak || ''));
}
