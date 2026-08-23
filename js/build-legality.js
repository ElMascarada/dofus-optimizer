function normalizeType(value = '') {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

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

export function evaluateNormalizedCondition(node, stats = {}) {
  if (!node) return true;
  if (node.kind === 'relation') {
    if (node.relation === 'and') return (node.children || []).every((child) => evaluateNormalizedCondition(child, stats));
    if (node.relation === 'or') return (node.children || []).some((child) => evaluateNormalizedCondition(child, stats));
    return false;
  }

  const actual = Number(stats?.[node.stat] || 0);
  if (node.operator === 'eq') return actual === node.value;
  if (node.operator === 'neq') return actual !== node.value;
  if (node.operator === 'gt') return actual > node.value;
  if (node.operator === 'gte') return actual >= node.value;
  if (node.operator === 'lt') return actual < node.value;
  if (node.operator === 'lte') return actual <= node.value;
  return false;
}

function intervalCouldSatisfy(operator, value, minimum, maximum) {
  const min = Number(minimum);
  const max = Number(maximum);
  const target = Number(value);
  if (!Number.isFinite(target)) return true;

  if (operator === 'eq') {
    if (Number.isFinite(min) && target < min) return false;
    if (Number.isFinite(max) && target > max) return false;
    return true;
  }
  if (operator === 'neq') {
    return !(Number.isFinite(min) && Number.isFinite(max) && min === max && min === target);
  }
  if (operator === 'gt') return !Number.isFinite(max) || max > target;
  if (operator === 'gte') return !Number.isFinite(max) || max >= target;
  if (operator === 'lt') return !Number.isFinite(min) || min < target;
  if (operator === 'lte') return !Number.isFinite(min) || min <= target;
  return true;
}

export function conditionCouldBeSatisfied(node, intervals = {}) {
  if (!node) return true;
  if (node.kind === 'relation') {
    const children = node.children || [];
    if (node.relation === 'and') return children.every((child) => conditionCouldBeSatisfied(child, intervals));
    if (node.relation === 'or') return children.some((child) => conditionCouldBeSatisfied(child, intervals));
    return true;
  }

  const interval = intervals[node.stat] || {};
  return intervalCouldSatisfy(node.operator, node.value, interval.min, interval.max);
}

export function hardConstraintIntervals(constraints = {}, characterLevel = 200) {
  const intervals = {
    level: { min: Number(characterLevel || 0), max: Number(characterLevel || 0) },
    setBonus: { min: 0, max: Infinity }
  };
  for (const [key, minimum] of Object.entries(constraints || {})) {
    if (!Number.isFinite(minimum) || minimum <= 0) continue;
    intervals[key] = { min: Number(minimum), max: Infinity };
  }
  return intervals;
}

export function itemConditionCompatibleWithHardConstraints(item, constraints = {}, characterLevel = 200) {
  return conditionCouldBeSatisfied(item?.conditions, hardConstraintIntervals(constraints, characterLevel));
}

export function selectedItemConditionsCouldStillBeValid(items = [], {
  constraints = {},
  characterLevel = 200,
  upperStats = {},
  currentSetBonus = 0,
  maxSetBonus = Infinity
} = {}) {
  const intervals = hardConstraintIntervals(constraints, characterLevel);
  for (const [key, maximum] of Object.entries(upperStats || {})) {
    const previous = intervals[key] || { min: -Infinity, max: Infinity };
    intervals[key] = { min: previous.min, max: Number.isFinite(maximum) ? Number(maximum) : previous.max };
  }
  intervals.setBonus = {
    min: Number(currentSetBonus || 0),
    max: Number.isFinite(maxSetBonus) ? Number(maxSetBonus) : Infinity
  };
  return items.every((item) => conditionCouldBeSatisfied(item?.conditions, intervals));
}

export function itemConditionsAreValid(items = [], finalStats = {}, characterLevel = 200) {
  const conditionStats = {
    ...finalStats,
    level: Number(characterLevel || 0),
    setBonus: countSetBonuses(items)
  };
  return items.every((item) => evaluateNormalizedCondition(item?.conditions, conditionStats));
}
