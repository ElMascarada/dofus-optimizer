import { evaluateObjective } from './spells.js';
import { collectConditionStatInfo, optimisticItemStats } from './search-space.js';
import { stat } from './stats.js';

const EPSILON = 1e-9;
const RESOURCE_KEYS = ['ap', 'mp'];

function objectiveScore(stats, selections, turnMode) {
  return Number(evaluateObjective({ stats, selections, turnMode }).score || 0);
}

function positiveObjectiveDelta(stats, selections, turnMode) {
  const baseline = objectiveScore({}, selections, turnMode);
  return Math.max(0, objectiveScore(stats || {}, selections, turnMode) - baseline);
}

function constraintContribution(stats = {}, constraints = {}) {
  let score = 0;
  let useful = false;
  const keys = [];
  for (const [key, minimumRaw] of Object.entries(constraints || {})) {
    const minimum = Number(minimumRaw);
    if (!(minimum > 0)) continue;
    const value = Math.max(0, stat(stats, key));
    if (!(value > 0)) continue;
    useful = true;
    keys.push(key);
    score += Math.min(1, value / minimum);
  }
  return { useful, score, keys };
}

function resourceContribution(stats = {}) {
  const keys = RESOURCE_KEYS.filter((key) => stat(stats, key) > 0);
  return { useful: keys.length > 0, keys, score: keys.reduce((sum, key) => sum + stat(stats, key), 0) };
}

function conditionContribution(stats = {}, conditionKeys = new Set()) {
  const keys = [...conditionKeys].filter((key) => stat(stats, key) > 0);
  const score = keys.reduce((sum, key) => sum + Math.max(0, stat(stats, key)), 0);
  return { useful: keys.length > 0, keys, score };
}

export function buildSetObjectiveProfiles(sets = [], selections = [], turnMode = 'sum', constraints = {}) {
  const profiles = new Map();
  for (const set of sets || []) {
    const thresholds = [];
    let bestOffensiveDelta = 0;
    let bestConstraintScore = 0;
    let bestThreshold = null;

    for (const [countText, bonus] of Object.entries(set?.bonuses || {})) {
      const count = Number(countText);
      if (!Number.isFinite(count) || count <= 0) continue;
      const offensiveDelta = positiveObjectiveDelta(bonus, selections, turnMode);
      const constraint = constraintContribution(bonus, constraints);
      const resource = resourceContribution(bonus);
      // Lower thresholds are easier to activate and therefore deserve more search priority.
      // This is an ordering weight only: it never changes the exact set bonus calculation.
      const activationWeight = 2 / Math.max(2, count);
      const priority = offensiveDelta * activationWeight
        + constraint.score * 2500 * activationWeight
        + resource.score * 1200 * activationWeight;
      const threshold = {
        count,
        bonus,
        offensiveDelta,
        constraintScore: constraint.score,
        resourceScore: resource.score,
        priority
      };
      thresholds.push(threshold);
      if (offensiveDelta > bestOffensiveDelta || (offensiveDelta === bestOffensiveDelta && priority > (bestThreshold?.priority || 0))) {
        bestOffensiveDelta = offensiveDelta;
        bestThreshold = threshold;
      }
      bestConstraintScore = Math.max(bestConstraintScore, constraint.score);
    }

    thresholds.sort((a, b) => b.priority - a.priority || a.count - b.count);
    profiles.set(set.id, {
      setId: set.id,
      name: set.name,
      thresholds,
      bestOffensiveDelta,
      bestConstraintScore,
      bestPriority: thresholds[0]?.priority || 0,
      hasOffensiveThreshold: thresholds.some((entry) => entry.offensiveDelta > EPSILON),
      hasConstraintThreshold: thresholds.some((entry) => entry.constraintScore > EPSILON || entry.resourceScore > EPSILON)
    });
  }
  return profiles;
}

export function classifyCandidate(item, {
  selections = [],
  turnMode = 'sum',
  constraints = {},
  setProfiles = new Map(),
  conditionKeys = new Set()
} = {}) {
  const optimistic = optimisticItemStats(item, { includePassives: true });
  const offensiveDelta = positiveObjectiveDelta(optimistic.stats, selections, turnMode);
  const constraint = constraintContribution(item?.stats || {}, constraints);
  const resource = resourceContribution(optimistic.stats);
  const condition = conditionContribution(item?.stats || {}, conditionKeys);
  const setProfile = item?.setId ? setProfiles.get(item.setId) : null;
  const setOffensive = Number(setProfile?.bestOffensiveDelta || 0);
  const setConstraint = Number(setProfile?.bestConstraintScore || 0);
  const setPriority = Number(setProfile?.bestPriority || 0);

  let role = 'neutral';
  if (offensiveDelta > EPSILON) role = 'offensive';
  else if (setOffensive > EPSILON) role = 'set-enabler';
  else if (resource.useful) role = 'resource';
  else if (constraint.useful || setConstraint > EPSILON) role = 'constraint';
  else if (condition.useful) role = 'prerequisite';

  // Search-order score only. The exact solver still validates every retained candidate.
  // Set potential is intentionally strong: a weak individual piece can be the key that
  // activates an exceptional two-piece bonus (the Volkorne pattern).
  // Offensive value is EXPECTED damage, so critical chance naturally rises only when
  // the selected spells actually gain damage from critical hits.
  const priority = offensiveDelta * 100
    + setPriority * 80
    + resource.score * 100000
    + constraint.score * 75000
    + setConstraint * 40000
    + condition.score * 100;

  return {
    role,
    priority,
    offensiveDelta,
    constraintScore: constraint.score,
    constraintKeys: constraint.keys,
    resourceKeys: resource.keys,
    prerequisiteKeys: condition.keys,
    setOffensiveDelta: setOffensive,
    setPriority,
    setName: setProfile?.name || null,
    objectiveBounded: optimistic.bounded
  };
}

export function buildCandidateClassifications(items = [], sets = [], selections = [], turnMode = 'sum', constraints = {}) {
  const setProfiles = buildSetObjectiveProfiles(sets, selections, turnMode, constraints);
  const conditionInfo = collectConditionStatInfo(items);
  const conditionKeys = new Set(conditionInfo.all || []);
  const byId = new Map();
  for (const item of items || []) {
    byId.set(item.id, classifyCandidate(item, {
      selections,
      turnMode,
      constraints,
      setProfiles,
      conditionKeys
    }));
  }
  return { setProfiles, byId, conditionKeys };
}

export function offensiveDofusPool(items = [], classifications = new Map()) {
  return (items || []).filter((item) => {
    if (item.slot !== 'dofus') return true;
    const classification = classifications.get(item.id);
    if (!classification) return true;
    // Pure defensive/utility Dofus do not belong to the offensive optimizer.
    // Constraint/resource/prerequisite pieces stay available because they can be needed
    // to make 12/6, resistance floors or another item's condition legal.
    return classification.role !== 'neutral';
  });
}

export function compareByOffensivePriority(a, b, classifications = new Map()) {
  const ac = classifications.get(a?.id);
  const bc = classifications.get(b?.id);
  return Number(bc?.priority || 0) - Number(ac?.priority || 0)
    || String(a?.id || '').localeCompare(String(b?.id || ''));
}
