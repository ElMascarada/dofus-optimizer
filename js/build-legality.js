import { effectiveStat } from './stats.js';

function normalizeType(value = '') {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

const INVESTABLE_STATS = new Set(['earth', 'fire', 'water', 'air']);

export const MAX_PERMANENT_AP = 12;

export function isPrysmaradite(item) {
  return item?.slotSubtype === 'prysmaradite' || normalizeType(item?.typeName).includes('prysmaradite');
}

export function countSetBonuses(items = []) {
  const counts = new Map();
  for (const item of items) {
    if (!item?.setId) continue;
    counts.set(item.setId, (counts.get(item.setId) || 0) + 1);
  }
  let bonuses = 0;
  for (const count of counts.values()) bonuses += Math.max(0, count - 1);
  return bonuses;
}

export function specialSlotRulesAreValid(items = []) {
  return items.filter(isPrysmaradite).length <= 1;
}

export function permanentStatCapViolations(stats = {}) {
  const ap = effectiveStat(stats, 'ap');
  return ap > MAX_PERMANENT_AP
    ? [{ stat: 'ap', actual: ap, maximum: MAX_PERMANENT_AP }]
    : [];
}

export function evaluateNormalizedCondition(node, stats = {}) {
  if (!node) return true;
  if (node.kind === 'relation') {
    if (node.relation === 'and') return (node.children || []).every((child) => evaluateNormalizedCondition(child, stats));
    if (node.relation === 'or') return (node.children || []).some((child) => evaluateNormalizedCondition(child, stats));
    return false;
  }

  const actual = effectiveStat(stats, node.stat);
  if (node.operator === 'eq') return actual === node.value;
  if (node.operator === 'neq') return actual !== node.value;
  if (node.operator === 'gt') return actual > node.value;
  if (node.operator === 'gte') return actual >= node.value;
  if (node.operator === 'lt') return actual < node.value;
  if (node.operator === 'lte') return actual <= node.value;
  return false;
}

function mergeMinimums(a = {}, b = {}) {
  const result = { ...a };
  for (const [stat, value] of Object.entries(b)) {
    result[stat] = Math.max(Number(result[stat] || 0), Number(value || 0));
  }
  return result;
}

function minimumDeficitScore(requirements = {}, stats = {}) {
  return Object.entries(requirements).reduce(
    (sum, [key, target]) => sum + Math.max(0, Number(target || 0) - Number(stats?.[key] || 0)),
    0
  );
}

function actionableMinimums(node, stats = {}) {
  if (!node || evaluateNormalizedCondition(node, stats)) return {};

  if (node.kind === 'relation') {
    const children = node.children || [];
    if (node.relation === 'and') {
      return children.reduce((requirements, child) => mergeMinimums(requirements, actionableMinimums(child, stats)), {});
    }
    if (node.relation === 'or') {
      const candidates = children
        .map((child) => actionableMinimums(child, stats))
        .filter((requirements) => Object.keys(requirements).length > 0)
        .sort((a, b) => minimumDeficitScore(a, stats) - minimumDeficitScore(b, stats));
      return candidates[0] || {};
    }
    return {};
  }

  if (!INVESTABLE_STATS.has(node.stat)) return {};
  if (node.operator === 'gte') return { [node.stat]: Number(node.value || 0) };
  if (node.operator === 'gt') return { [node.stat]: Number(node.value || 0) + 1 };
  return {};
}

// Convert equipment requirements that can be solved with characteristic points
// into minimum final elemental stats. This lets the characteristic allocator
// repair a build before declaring an otherwise excellent item illegal.
export function characteristicMinimumsForItems(items = [], currentStats = {}, characterLevel = 200) {
  const conditionStats = {
    ...currentStats,
    level: Number(characterLevel || 0),
    setBonus: countSetBonuses(items)
  };
  let requirements = {};
  for (const item of items) {
    requirements = mergeMinimums(requirements, actionableMinimums(item?.conditions, conditionStats));
  }
  return requirements;
}

export function itemConditionsAreValid(items = [], finalStats = {}, characterLevel = 200) {
  const conditionStats = {
    ...finalStats,
    level: Number(characterLevel || 0),
    setBonus: countSetBonuses(items)
  };
  return items.every((item) => evaluateNormalizedCondition(item?.conditions, conditionStats));
}
