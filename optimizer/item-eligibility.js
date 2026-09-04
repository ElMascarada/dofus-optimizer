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

export function isOptimizerEligibleItem(item) {
  if (!isTrophy(item)) return true;
  return !conditionRequiresSetBonusBelowThree(item.conditions);
}

export function filterOptimizerEligibleItems(items = []) {
  return (items || []).filter(isOptimizerEligibleItem);
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
