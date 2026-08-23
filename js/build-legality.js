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

export function itemConditionsAreValid(items = [], finalStats = {}, characterLevel = 200) {
  const conditionStats = {
    ...finalStats,
    level: Number(characterLevel || 0),
    setBonus: countSetBonuses(items)
  };
  return items.every((item) => evaluateNormalizedCondition(item?.conditions, conditionStats));
}
