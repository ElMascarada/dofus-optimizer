import { stat } from './stats.js';

function uniqueBundles(bundles) {
  const seen = new Set();
  return bundles.filter((keys) => {
    const normalized = [...new Set(keys)].sort();
    if (normalized.length < 2) return false;
    const signature = normalized.join('|');
    if (seen.has(signature)) return false;
    seen.add(signature);
    keys.splice(0, keys.length, ...normalized);
    return true;
  });
}

export function buildConstraintBundles(constraints = {}) {
  const positive = Object.entries(constraints)
    .filter(([, value]) => Number.isFinite(value) && Number(value) > 0)
    .map(([key]) => key);
  const resistances = ['resEarth', 'resFire', 'resWater', 'resAir'].filter((key) => Number(constraints[key]) > 0);
  const bundles = [];

  if (resistances.length >= 2) {
    bundles.push([...resistances]);
    for (let i = 0; i < resistances.length; i++) {
      for (let j = i + 1; j < resistances.length; j++) bundles.push([resistances[i], resistances[j]]);
    }
  }
  const mobility = ['ap', 'mp'].filter((key) => Number(constraints[key]) > 0);
  if (mobility.length >= 2) bundles.push(mobility);
  if (positive.length >= 2) bundles.push([...positive]);

  return uniqueBundles(bundles).map((keys) => ({
    id: keys.join('+'),
    keys,
    weights: Object.fromEntries(keys.map((key) => [key, 1 / Number(constraints[key])])),
    target: keys.length
  }));
}

export function weightedStatScore(stats = {}, bundle) {
  let score = 0;
  for (const key of bundle.keys) score += stat(stats, key) * Number(bundle.weights[key] || 0);
  return score;
}

function groupWeightedMaximum(group, bundle) {
  if (group.dynamic) {
    // If the dynamic group has already built a Pareto frontier on the exact hard
    // constraints, use that legal multi-pick frontier rather than summing six
    // independent per-item maxima that might be mutually incompatible.
    if (group.hardConstraintChoices?.length) {
      let best = Number.NEGATIVE_INFINITY;
      for (const choice of group.hardConstraintChoices) {
        best = Math.max(best, weightedStatScore(choice.stats || {}, bundle));
      }
      return Number.isFinite(best) ? best : 0;
    }

    const scores = (group.candidates || [])
      .map((item) => weightedStatScore(item.stats || {}, bundle))
      .sort((a, b) => b - a);
    let total = 0;
    for (let index = 0; index < Number(group.count || 0); index++) total += Number(scores[index] || 0);
    return total;
  }
  let best = Number.NEGATIVE_INFINITY;
  for (const choice of group.choices || []) best = Math.max(best, weightedStatScore(choice.stats || {}, bundle));
  return Number.isFinite(best) ? best : 0;
}

export function buildFutureConstraintBundleCaps(groups = [], bundles = []) {
  const suffix = new Array(groups.length + 1);
  suffix[groups.length] = Object.fromEntries(bundles.map((bundle) => [bundle.id, 0]));
  for (let index = groups.length - 1; index >= 0; index--) {
    const row = {};
    for (const bundle of bundles) {
      row[bundle.id] = Number(suffix[index + 1][bundle.id] || 0) + groupWeightedMaximum(groups[index], bundle);
    }
    suffix[index] = row;
  }
  return suffix;
}

export function canMeetJointConstraintBundles({
  rawStats = {},
  bundles = [],
  futureCaps = {},
  setUpper = {},
  charUpper = {},
  fmUpper = {}
} = {}) {
  for (const bundle of bundles) {
    const possible = weightedStatScore(rawStats, bundle)
      + Number(futureCaps[bundle.id] || 0)
      + weightedStatScore(setUpper, bundle)
      + weightedStatScore(charUpper, bundle)
      + weightedStatScore(fmUpper, bundle);
    if (possible + 1e-9 < bundle.target) return false;
  }
  return true;
}