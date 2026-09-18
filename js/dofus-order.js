import { effectiveStat } from './stats.js';
import {
  evaluateSyntheticOffense,
  normalizeSyntheticCritMode
} from './synthetic-offense.js';

export function isDofusTurquoise(item) {
  return /^Dofus Turquoise$/i.test(String(item?.name || ''));
}

function subtractItemStats(stats = {}, item = {}) {
  const next = { ...(stats || {}) };
  for (const [key, value] of Object.entries(item?.stats || {})) {
    const number = Number(value);
    if (!Number.isFinite(number)) continue;
    next[key] = Number(next[key] || 0) - number;
  }
  return next;
}

function violatesHardConstraint(stats = {}, constraints = {}) {
  return Object.entries(constraints || {}).some(([key, rawMinimum]) => {
    const minimum = Number(rawMinimum || 0);
    if (!Number.isFinite(minimum) || minimum <= 0) return false;
    return effectiveStat(stats, key) < minimum;
  });
}

function marginalSyntheticLoss(result = {}, item = {}) {
  const context = result?.workspaceContext?.syntheticOffense || {};
  if (!(context.elements || []).length || !(context.profiles || []).length) return 0;

  const afterStats = subtractItemStats(result?.stats || {}, item);
  let after;
  try {
    after = evaluateSyntheticOffense({
      stats: afterStats,
      availableAp: effectiveStat(afterStats, 'ap'),
      elements: context.elements,
      profiles: context.profiles,
      critMode: context.critMode
    });
  } catch {
    return 0;
  }

  const before = Number(result?.syntheticOffense?.minimumScore || 0);
  const afterScore = Number(after?.minimumScore || 0);
  return Number.isFinite(before - afterScore) ? before - afterScore : 0;
}

export function orderDofusItems(items = [], result = {}) {
  const critMode = normalizeSyntheticCritMode(
    result?.workspaceContext?.syntheticOffense?.critMode
      || result?.syntheticOffense?.critMode
      || 'auto'
  );
  const constraints = result?.workspaceContext?.constraints || {};
  const totalStats = result?.stats || {};

  return (items || [])
    .map((item, index) => {
      const afterStats = subtractItemStats(totalStats, item);
      return {
        item,
        index,
        forcedCrit: critMode === 'crit' && isDofusTurquoise(item),
        constraintCritical: violatesHardConstraint(afterStats, constraints),
        marginalLoss: marginalSyntheticLoss(result, item)
      };
    })
    .sort((left, right) =>
      Number(right.forcedCrit) - Number(left.forcedCrit)
      || Number(right.constraintCritical) - Number(left.constraintCritical)
      || Number(right.marginalLoss) - Number(left.marginalLoss)
      || left.index - right.index
    )
    .map((entry) => entry.item);
}
