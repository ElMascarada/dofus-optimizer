import './runtime-meta.js';
import { OPTIMIZER_V2_CONSTRAINT_KEYS } from './optimizer-v2-orchestrator.js';

export const NORMALIZED_SEARCH_QUERY_VERSION = 1;

const memoryMeta = globalThis.DofusOptimizerRuntime?.searchMemory || {};
export const SEARCH_RULES_VERSION = String(memoryMeta.rulesVersion || 'optimizer-rules-v1');
export const SEARCH_ENGINE_VERSION = String(memoryMeta.searchVersion || 'optimizer-search-v1');

function nonNegativeNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function snapshotVersion(snapshot = {}) {
  return stableValue({
    schemaVersion: Number(snapshot?.schemaVersion || 0),
    gameVersion: String(snapshot?.gameVersion?.version || ''),
    generatedAt: String(snapshot?.generatedAt || '')
  });
}

export function createSearchVersionContext({
  dataset = {},
  spellData = {},
  rulesVersion = SEARCH_RULES_VERSION,
  searchVersion = SEARCH_ENGINE_VERSION
} = {}) {
  return {
    dataVersion: JSON.stringify(stableValue({
      items: snapshotVersion(dataset),
      spells: snapshotVersion(spellData)
    })),
    rulesVersion: String(rulesVersion || SEARCH_RULES_VERSION),
    searchVersion: String(searchVersion || SEARCH_ENGINE_VERSION)
  };
}

function normalizeRequiredApByTurn(value = {}) {
  return Object.fromEntries([1, 2, 3].map((turn) => [String(turn), nonNegativeNumber(value?.[turn])]));
}

function normalizeConstraints(constraints = {}) {
  return Object.fromEntries(
    OPTIMIZER_V2_CONSTRAINT_KEYS.map((key) => [key, nonNegativeNumber(constraints?.[key])])
  );
}

/**
 * @typedef {Object} NormalizedSearchQuery
 * Canonical, catalog-free representation of one optimizer request.
 */
export function normalizeSearchQuery(payload = {}, versions = {}) {
  return stableValue({
    schemaVersion: NORMALIZED_SEARCH_QUERY_VERSION,
    versions: {
      dataVersion: String(versions?.dataVersion || ''),
      rulesVersion: String(versions?.rulesVersion || SEARCH_RULES_VERSION),
      searchVersion: String(versions?.searchVersion || SEARCH_ENGINE_VERSION)
    },
    classId: String(payload?.classId || payload?.breedId || ''),
    element: String(payload?.combatObjective?.element || 'multi'),
    turnMode: String(payload?.turnMode || payload?.combatObjective?.turnMode || 'sum'),
    constraints: normalizeConstraints(payload?.constraints),
    combatObjective: {
      targetMode: String(payload?.combatObjective?.targetMode || 'single'),
      areaTargets: Math.max(1, Math.floor(nonNegativeNumber(payload?.combatObjective?.areaTargets) || 1)),
      allowSupport: payload?.combatObjective?.allowSupport !== false,
      metric: String(payload?.combatObjective?.metric || 'total-damage')
    },
    fmPolicy: {
      spellDamagePct: nonNegativeNumber(payload?.fmPolicy?.spellDamagePct),
      allowCritDamage: Boolean(payload?.fmPolicy?.allowCritDamage),
      critDamageAmount: nonNegativeNumber(payload?.fmPolicy?.critDamageAmount),
      structuralExos: Boolean(payload?.fmPolicy?.structuralExos)
    },
    scenario: {
      requiredApByTurn: normalizeRequiredApByTurn(payload?.scenario?.requiredApByTurn)
    },
    diversityMode: String(payload?.diversityMode || 'gear'),
    searchProfile: String(payload?.searchProfile || 'BALANCED').toUpperCase(),
    topN: Math.max(1, Math.floor(nonNegativeNumber(payload?.topN) || 10)),
    requiredItemIds: [...new Set((payload?.requiredItemIds || []).map(String).filter(Boolean))].sort()
  });
}

export function searchFingerprint(query = {}) {
  return `normalized-search-v${NORMALIZED_SEARCH_QUERY_VERSION}:${JSON.stringify(stableValue(query))}`;
}

export function searchVersionsAreCompatible(left = {}, right = {}) {
  return Number(left?.schemaVersion || 0) === NORMALIZED_SEARCH_QUERY_VERSION
    && Number(right?.schemaVersion || 0) === NORMALIZED_SEARCH_QUERY_VERSION
    && String(left?.versions?.dataVersion || '') === String(right?.versions?.dataVersion || '')
    && String(left?.versions?.rulesVersion || '') === String(right?.versions?.rulesVersion || '')
    && String(left?.versions?.searchVersion || '') === String(right?.versions?.searchVersion || '');
}

function relativeDelta(a, b) {
  const left = nonNegativeNumber(a);
  const right = nonNegativeNumber(b);
  return Math.abs(left - right) / Math.max(1, left, right);
}

const SINGLE_TURN_MODES = new Set(['t1', 't2', 't3']);
const MULTI_TURN_MODES = new Set(['sum', 'average', 'min']);

function turnModePenalty(left, right) {
  if (left === right) return 0;
  if (SINGLE_TURN_MODES.has(left) && SINGLE_TURN_MODES.has(right)) return 0.2;
  if (MULTI_TURN_MODES.has(left) && MULTI_TURN_MODES.has(right)) return 0.2;
  return 0.5;
}

export function searchQuerySimilarity(query = {}, candidate = {}) {
  if (!searchVersionsAreCompatible(query, candidate)) return 0;
  if (!query.classId || query.classId !== candidate.classId) return 0;
  if (query.element !== candidate.element) return 0;
  if (query.combatObjective?.targetMode !== candidate.combatObjective?.targetMode) return 0;
  if (query.combatObjective?.metric !== candidate.combatObjective?.metric) return 0;

  const constraintDistance = OPTIMIZER_V2_CONSTRAINT_KEYS.reduce(
    (sum, key) => sum + relativeDelta(query?.constraints?.[key], candidate?.constraints?.[key]),
    0
  ) / Math.max(1, OPTIMIZER_V2_CONSTRAINT_KEYS.length);
  const fmDistance = relativeDelta(query?.fmPolicy?.spellDamagePct, candidate?.fmPolicy?.spellDamagePct)
    + relativeDelta(query?.fmPolicy?.critDamageAmount, candidate?.fmPolicy?.critDamageAmount)
    + Number(Boolean(query?.fmPolicy?.allowCritDamage) !== Boolean(candidate?.fmPolicy?.allowCritDamage));
  const distance = constraintDistance
    + turnModePenalty(query.turnMode, candidate.turnMode)
    + fmDistance * 0.25;
  return 1 / (1 + distance);
}
