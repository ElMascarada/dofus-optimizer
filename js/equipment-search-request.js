import { compareCompleteEquipmentBuildResults } from './complete-equipment-build-evaluator.js';
import { searchEquipmentArchitecturesV2 } from './equipment-search-v2.js';
import { searchMultiElementSetCoreEquipment } from '../optimizer/multi-element-set-core-search.js';
import {
  compareSyntheticOffenseResults,
  evaluateSyntheticOffense,
  normalizeSyntheticCritMode
} from './synthetic-offense.js';

const ELEMENTS = Object.freeze(['earth', 'fire', 'water', 'air']);
const FORGEABLE_SLOTS = new Set(['hat', 'cape', 'amulet', 'ring', 'belt', 'boots', 'weapon', 'shield']);
const FM_SENSITIVE_CONSTRAINTS = new Set(['critDamage', 'spellDamagePct']);

function unique(values = []) {
  return [...new Set((values || []).map((value) => String(value || '').trim().toLowerCase()).filter(Boolean))];
}

function requestedElements(syntheticOffense = {}) {
  const raw = unique(syntheticOffense?.elements);
  if (raw.includes('multi')) return ['multi'];
  return raw.filter((element) => ELEMENTS.includes(element));
}

function isMultiElementRequest(syntheticOffense = {}) {
  const requested = requestedElements(syntheticOffense);
  return requested[0] === 'multi' || requested.length > 1;
}

function searchConstraints(constraints = {}) {
  return Object.fromEntries(Object.entries(constraints || {})
    .filter(([key]) => !FM_SENSITIVE_CONSTRAINTS.has(key)));
}

function constraintsSatisfied(stats = {}, constraints = {}) {
  return Object.entries(constraints || {}).every(([key, minimum]) => {
    const target = Number(minimum || 0);
    return !Number.isFinite(target) || target <= 0 || Number(stats?.[key] || 0) >= target;
  });
}

function itemName(result, pattern) {
  return (result?.items || []).some((item) => pattern.test(String(item?.name || '')));
}

function critModeAllows(result, critMode) {
  if (critMode === 'crit' && itemName(result, /^Robuste(?: majeur)?$/i)) return false;
  if (critMode === 'no_crit' && itemName(result, /^Dofus Turquoise$/i)) return false;
  return true;
}

function structuralIds(result) {
  return new Set((result?.fm?.assignments || [])
    .filter((entry) => entry?.type === 'exoAp' || entry?.type === 'exoMp')
    .map((entry) => String(entry.itemId)));
}

function fmBaseStats(result) {
  const stats = { ...(result?.stats || {}) };
  const fm = result?.fm || {};
  if (!fm.enabled) return stats;
  stats.spellDamagePct = Number(stats.spellDamagePct || 0) - Number(fm.spellPctItems || 0);
  stats.critDamage = Number(stats.critDamage || 0) - Number(fm.critItems || 0) * 8;
  return stats;
}

function fmShape(result) {
  const fm = result?.fm || {};
  if (!fm.enabled) return { offensiveItems: [], critEligible: [] };
  const blocked = structuralIds(result);
  const offensiveItems = (result?.items || [])
    .filter((item) => FORGEABLE_SLOTS.has(item?.slot) && !blocked.has(String(item?.id)))
    .sort((a, b) => String(a?.id ?? '').localeCompare(String(b?.id ?? '')));
  const critEligible = offensiveItems.filter((item) => Number(item?.stats?.critDamage || 0) === 0);
  return { offensiveItems, critEligible };
}

function scoreResultForRequest(result, syntheticOffense = {}, constraints = {}) {
  const critMode = normalizeSyntheticCritMode(syntheticOffense?.critMode);
  if (!critModeAllows(result, critMode)) return null;

  const fm = result?.fm || {};
  const baseStats = fmBaseStats(result);
  const { offensiveItems, critEligible } = fmShape(result);
  const variants = [];

  if (!fm.enabled) {
    variants.push({ stats: baseStats, critCount: 0, spellCount: 0 });
  } else {
    for (let critCount = 0; critCount <= critEligible.length; critCount++) {
      const spellCount = offensiveItems.length - critCount;
      variants.push({
        stats: {
          ...baseStats,
          spellDamagePct: Number(baseStats.spellDamagePct || 0) + spellCount,
          critDamage: Number(baseStats.critDamage || 0) + critCount * 8
        },
        critCount,
        spellCount
      });
    }
  }

  let best = null;
  for (const variant of variants) {
    if (!constraintsSatisfied(variant.stats, constraints)) continue;
    const offense = evaluateSyntheticOffense({
      stats: variant.stats,
      availableAp: Number(variant.stats.ap || result?.syntheticApBudget || 0),
      elements: syntheticOffense?.elements,
      profiles: syntheticOffense?.profiles,
      critMode
    });
    if (!best || compareSyntheticOffenseResults(offense, best.offense) > 0) {
      best = { ...variant, offense };
    }
  }
  if (!best) return null;

  return {
    ...result,
    stats: best.stats,
    score: best.offense.minimumScore,
    fm: {
      ...fm,
      critItems: fm.enabled ? best.critCount : Number(fm.critItems || 0),
      spellPctItems: fm.enabled ? best.spellCount : Number(fm.spellPctItems || 0)
    },
    syntheticOffense: best.offense,
    rankingTuple: [best.offense.minimumScore, best.offense.meanScore, result.buildIdentity]
  };
}

function insertResult(results, candidate, topN) {
  if (!candidate) return;
  const existing = results.findIndex((entry) => entry.buildIdentity === candidate.buildIdentity);
  if (existing >= 0) results.splice(existing, 1);
  results.push(candidate);
  results.sort((left, right) => -compareCompleteEquipmentBuildResults(left, right));
  if (results.length > topN) results.length = topN;
}

function finalizeResults(rawResults, syntheticOffense, constraints, topN) {
  const output = [];
  for (const result of rawResults || []) {
    insertResult(output, scoreResultForRequest(result, syntheticOffense, constraints), topN);
  }
  return output;
}

export function searchEquipmentRequest({
  items = [],
  sets = [],
  constraints = {},
  fmPolicy = {},
  syntheticOffense = {},
  requiredItemIds = [],
  topN = 10,
  searchProfile = 'BALANCED',
  onProgress = null,
  onDiagnostics = null
} = {}) {
  const effectiveConstraints = searchConstraints(constraints);
  const resultLimit = Math.max(1, Number(topN || 10));
  const critMode = normalizeSyntheticCritMode(syntheticOffense?.critMode);
  const combinedRequest = isMultiElementRequest(syntheticOffense);
  const rawLimit = combinedRequest
    ? Math.max(resultLimit, critMode === 'auto' ? 100 : 120)
    : (critMode === 'auto' ? resultLimit : Math.max(resultLimit, 80));

  const request = {
    items,
    sets,
    constraints: effectiveConstraints,
    fmPolicy,
    syntheticOffense: {
      ...syntheticOffense,
      critMode
    },
    requiredItemIds,
    topN: rawLimit,
    searchProfile,
    onProgress,
    onDiagnostics
  };

  const direct = combinedRequest
    ? searchMultiElementSetCoreEquipment(request)
    : searchEquipmentArchitecturesV2(request);
  const results = finalizeResults(direct?.results || [], syntheticOffense, constraints, resultLimit);
  return {
    ...direct,
    results,
    diagnostics: {
      ...(direct?.diagnostics || {}),
      requestSearchMode: combinedRequest ? 'multi-element-native' : 'single-element',
      requestedElements: requestedElements(syntheticOffense),
      nativeCombinedObjective: combinedRequest,
      critMode,
      valid: results.length
    }
  };
}
