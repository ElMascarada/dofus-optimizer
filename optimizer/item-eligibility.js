function conditionRequiresSetBonusBelowThree(node) {
  if (!node) return false;
  if (Array.isArray(node)) return node.some(conditionRequiresSetBonusBelowThree);
  if (typeof node !== 'object') return false;

  if (node.kind === 'condition') {
    return node.stat === 'setBonus'
      && node.operator === 'lt'
      && Number(node.value) === 3;
  }

  return Array.isArray(node.children)
    && node.children.some(conditionRequiresSetBonusBelowThree);
}

function isTrophy(item) {
  return item?.typeName === 'Trophée';
}

export function itemConditionCanSatisfyHardMinimums(node, constraints = {}) {
  if (!node || typeof node !== 'object') return true;

  if (node.kind === 'relation') {
    const children = node.children || [];
    if (node.relation === 'and') {
      return children.every((child) =>
        itemConditionCanSatisfyHardMinimums(child, constraints)
      );
    }
    if (node.relation === 'or') {
      return children.some((child) =>
        itemConditionCanSatisfyHardMinimums(child, constraints)
      );
    }
    return true;
  }

  if (node.kind !== 'condition') return true;

  const minimum = Number(constraints?.[node.stat]);
  const value = Number(node.value);

  if (!Number.isFinite(minimum) || minimum <= 0 || !Number.isFinite(value)) {
    return true;
  }

  if (node.operator === 'lt') return minimum < value;
  if (node.operator === 'lte') return minimum <= value;
  if (node.operator === 'eq') return value >= minimum;

  // A lower bound alone cannot prove gt/gte/neq impossible.
  return true;
}

export function isOptimizerEligibleItem(item, constraints = {}) {
  if (isTrophy(item) && conditionRequiresSetBonusBelowThree(item.conditions)) {
    return false;
  }
  return itemConditionCanSatisfyHardMinimums(item?.conditions, constraints);
}

export function filterOptimizerEligibleItems(items = [], constraints = {}) {
  return (items || []).filter((item) =>
    isOptimizerEligibleItem(item, constraints)
  );
}

export function optimizerTrophyEligibilityCounts(items = []) {
  const source = items || [];
  const before = source.filter(isTrophy).length;
  const after = source.filter((item) => isTrophy(item) && isOptimizerEligibleItem(item)).length;
  return {
    trophiesBefore: before,
    trophiesAfter: after,
    setRestrictedTrophiesExcluded: before - after
  };
}
