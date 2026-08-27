const QUERY_SCHEMA_VERSION = 2;
export const SEARCH_QUERY_SCHEMA_VERSION = QUERY_SCHEMA_VERSION;
export const SEARCH_ALGORITHM_VERSION = 'optimizer-search-v2-memory-1';

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

export function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

export function fnv1a(text = '') {
  let hash = 0x811c9dc5;
  for (let index = 0; index < String(text).length; index++) {
    hash ^= String(text).charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function snapshotStamp(snapshot = {}, ids = []) {
  const gameVersion = snapshot?.gameVersion?.version || snapshot?.gameVersion?.name || 'unknown';
  const generatedAt = snapshot?.generatedAt || 'unknown';
  const signature = fnv1a([...ids].map(String).sort().join('|'));
  return `${gameVersion}@${generatedAt}:${signature}`;
}

export function searchDataVersion({ dataset = {}, spellData = {} } = {}) {
  return `data-v1:items:${snapshotStamp(dataset, (dataset.items || []).map((item) => item?.id))}:spells:${snapshotStamp(spellData, (spellData.spells || []).map((spell) => spell?.id))}`;
}

export function createSearchVersions({
  dataset = {},
  spellData = {},
  rulesVersion = 'unknown',
  searchVersion = SEARCH_ALGORITHM_VERSION
} = {}) {
  return Object.freeze({
    data: searchDataVersion({ dataset, spellData }),
    rules: String(rulesVersion || 'unknown'),
    search: String(searchVersion || SEARCH_ALGORITHM_VERSION)
  });
}

function normalizedNumberObject(value = {}) {
  return Object.fromEntries(Object.keys(value || {}).sort().map((key) => [key, finiteNumber(value[key]) ]));
}

function normalizedFmPolicy(value = {}) {
  return Object.fromEntries(Object.keys(value || {}).sort().map((key) => {
    const raw = value[key];
    return [key, typeof raw === 'boolean' ? raw : finiteNumber(raw)];
  }));
}

function normalizedScenario(value = {}) {
  const requiredApByTurn = normalizedNumberObject(value?.requiredApByTurn || {});
  return { requiredApByTurn };
}

function normalizedItemIds(value = []) {
  return [...new Set((value || []).map(String).filter(Boolean))].sort();
}

function normalizedLockedItemsBySlot(value = {}) {
  return Object.fromEntries(Object.entries(value || {})
    .map(([slotKey, itemId]) => [String(slotKey), String(itemId || '')])
    .filter(([, itemId]) => Boolean(itemId))
    .sort(([left], [right]) => left.localeCompare(right)));
}

export function normalizeSearchQuery({ payload = {}, versions = {} } = {}) {
  const combatObjective = payload?.combatObjective || {};
  return Object.freeze({
    schemaVersion: QUERY_SCHEMA_VERSION,
    versions: {
      data: String(versions?.data || ''),
      rules: String(versions?.rules || ''),
      search: String(versions?.search || '')
    },
    classId: String(payload?.classId || payload?.breedId || ''),
    objectiveMode: String(payload?.objectiveMode || 'combat'),
    element: String(combatObjective.element || 'multi'),
    turnMode: String(combatObjective.turnMode || payload?.turnMode || 'sum'),
    combatObjective: {
      targetMode: String(combatObjective.targetMode || 'single'),
      areaTargets: Math.max(1, finiteNumber(combatObjective.areaTargets, 1)),
      allowSupport: combatObjective.allowSupport !== false,
      metric: String(combatObjective.metric || 'total-damage')
    },
    constraints: normalizedNumberObject(payload?.constraints || {}),
    fmPolicy: normalizedFmPolicy(payload?.fmPolicy || {}),
    scenario: normalizedScenario(payload?.scenario || {}),
    diversityMode: String(payload?.diversityMode || 'gear'),
    searchProfile: String(payload?.searchProfile || 'BALANCED').toUpperCase(),
    topN: Math.max(1, Math.floor(finiteNumber(payload?.topN, 10))),
    requiredItemIds: normalizedItemIds(payload?.requiredItemIds),
    lockedItemsBySlot: normalizedLockedItemsBySlot(payload?.lockedItemsBySlot),
    rejectedItemIds: normalizedItemIds(payload?.rejectedItemIds)
  });
}

export function searchFingerprint(query = {}) {
  return `search-v${QUERY_SCHEMA_VERSION}:${fnv1a(stableStringify(query))}`;
}

export function searchQueriesEqual(a, b) {
  return stableStringify(a) === stableStringify(b);
}

export function searchVersionsCompatible(a = {}, b = {}) {
  return Boolean(a?.data && a?.rules && a?.search)
    && String(a.data) === String(b?.data || '')
    && String(a.rules) === String(b?.rules || '')
    && String(a.search) === String(b?.search || '');
}

function relativeDifference(a, b) {
  const left = finiteNumber(a);
  const right = finiteNumber(b);
  return Math.abs(left - right) / Math.max(1, Math.abs(left), Math.abs(right));
}

function exactCompatibilityFieldsMatch(a, b) {
  return a.classId === b.classId
    && a.objectiveMode === b.objectiveMode
    && a.element === b.element
    && a.turnMode === b.turnMode
    && stableStringify(a.combatObjective) === stableStringify(b.combatObjective)
    && stableStringify(a.fmPolicy) === stableStringify(b.fmPolicy)
    && stableStringify(a.scenario) === stableStringify(b.scenario)
    && a.diversityMode === b.diversityMode
    && a.searchProfile === b.searchProfile
    && stableStringify(a.requiredItemIds) === stableStringify(b.requiredItemIds)
    && stableStringify(a.lockedItemsBySlot) === stableStringify(b.lockedItemsBySlot)
    && stableStringify(a.rejectedItemIds) === stableStringify(b.rejectedItemIds);
}

export function searchQueryDistance(a = {}, b = {}) {
  if (!searchVersionsCompatible(a?.versions, b?.versions)) return Infinity;
  if (!exactCompatibilityFieldsMatch(a, b)) return Infinity;
  const keys = [...new Set([...Object.keys(a.constraints || {}), ...Object.keys(b.constraints || {})])].sort();
  const constraintDistance = keys.length
    ? keys.reduce((sum, key) => sum + relativeDifference(a.constraints?.[key], b.constraints?.[key]), 0) / keys.length
    : 0;
  const topNDistance = relativeDifference(a.topN, b.topN) * 0.05;
  return constraintDistance + topNDistance;
}
