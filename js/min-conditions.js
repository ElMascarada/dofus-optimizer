import { MIN_CONDITION_KEYS, MIN_CONDITION_STATS } from './stat-catalog.js';

const SUPPORTED = new Set(MIN_CONDITION_KEYS);
let activeConditions = [];

function nonNegativeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

export function normalizeMinCondition(condition = {}) {
  const key = String(condition.key || '');
  if (!SUPPORTED.has(key)) throw new Error(`Condition minimale non supportée: ${key || '?'}`);
  return { key, value: nonNegativeNumber(condition.value) };
}

export function addMinCondition(conditions = [], condition = {}) {
  const normalized = normalizeMinCondition(condition);
  const next = (conditions || []).filter((entry) => entry?.key !== normalized.key)
    .map((entry) => normalizeMinCondition(entry));
  next.push(normalized);
  return next.sort((left, right) => MIN_CONDITION_KEYS.indexOf(left.key) - MIN_CONDITION_KEYS.indexOf(right.key));
}

export function removeMinCondition(conditions = [], key) {
  return (conditions || []).filter((entry) => entry?.key !== key).map((entry) => normalizeMinCondition(entry));
}

export function constraintsFromMinConditions(conditions = []) {
  return Object.fromEntries((conditions || []).map((condition) => {
    const normalized = normalizeMinCondition(condition);
    return [normalized.key, normalized.value];
  }));
}

export function mergeMinimumConstraints(base = {}, conditions = []) {
  const merged = { ...(base || {}) };
  for (const [key, value] of Object.entries(constraintsFromMinConditions(conditions))) {
    merged[key] = Math.max(nonNegativeNumber(merged[key]), value);
  }
  return merged;
}

export function setActiveMinConditions(conditions = []) {
  activeConditions = (conditions || []).reduce((next, condition) => addMinCondition(next, condition), []);
  return getActiveMinConditions();
}

export function getActiveMinConditions() {
  return activeConditions.map((condition) => ({ ...condition }));
}

export function activeMinimumConstraints(base = {}) {
  return mergeMinimumConstraints(base, activeConditions);
}

export { MIN_CONDITION_KEYS, MIN_CONDITION_STATS };
