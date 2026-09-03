import { BASE_CHARACTER, SLOT_RULES } from '../js/config.js';
import { FM_ELIGIBLE_SLOTS } from '../js/fm.js';
import { optimisticItemStats } from '../js/search-space.js';
import { evaluateObjectiveUpperBound } from '../js/spells.js';
import { addStats, emptyStats } from '../js/stats.js';
import { applySetBonuses } from '../js/sets.js';
import { isPrysmaradite } from '../js/build-legality.js';
import { GENERIC_OFFENSE_KEYS, positiveConstraintKeys } from './candidate-policy.js';

const branchEnvelopeCache = new WeakMap();
const offensiveEnvelopeCache = new WeakMap();

function num(stats, key) {
  const value = Number(stats?.[key] || 0);
  return Number.isFinite(value) ? value : 0;
}

function addPositive(target, source = {}) {
  for (const [key, raw] of Object.entries(source || {})) {
    const value = Number(raw || 0);
    if (!Number.isFinite(value) || value <= 0) continue;
    target[key] = Number(target[key] || 0) + value;
  }
  return target;
}

export function signedConstraintOrderingSignal(stats, constraints = {}, baselineStats = {}) {
  let signal = 0;
  for (const key of positiveConstraintKeys(constraints)) {
    const target = Math.max(1, Number(constraints[key] || 0));
    const value = num(baselineStats, key) + num(stats, key);
    // Constraint progress is useful only until the admissibility floor is met.
    // Preserve signed deficits/penalties, but never reward surplus resources.
    signal += Math.min(1, value / target);
  }
  return signal;
}

function addSignedConstraintStats(target, candidate, keys = []) {
  for (const key of keys) {
    const optimistic = num(candidate?.optimisticStats, key);
    const fixedPenalty = Math.min(0, num(candidate?.item?.stats, key));
    target[key] = num(target, key) + optimistic + fixedPenalty;
  }
  return target;
}

function constraintBaselineStats(context = {}) {
  return {
    ...(BASE_CHARACTER.baseStats || {}),
    ap: num(BASE_CHARACTER.baseStats, 'ap') + (Number(context.fmPolicy?.exoAp) === 1 ? 1 : 0),
    mp: num(BASE_CHARACTER.baseStats, 'mp') + (Number(context.fmPolicy?.exoMp) === 1 ? 1 : 0)
  };
}

function constraintContributionTarget(key, constraints = {}, baselineStats = BASE_CHARACTER.baseStats || {}) {
  const target = Math.max(0, Number(constraints?.[key] || 0));
  return Math.max(0, target - Math.max(0, num(baselineStats, key)));
}

function retentionStat(state, key, constraintKeys, constraints = {}, baselineStats = BASE_CHARACTER.baseStats || {}) {
  if (!constraintKeys.has(key)) return num(state.optimisticStats, key);
  const value = num(state.constraintStats, key);
  const target = constraintContributionTarget(key, constraints, baselineStats);
  if (!(target > 0)) return Math.min(0, value);
  return Math.min(target, value);
}

function rankGroupState(optimisticStats, constraintStats, context) {
  const ranked = context.policy.rankStats(optimisticStats);
  const signedConstraintSignal = signedConstraintOrderingSignal(
    constraintStats,
    context.constraints,
    constraintBaselineStats(context)
  );
  const constraintWeight = Number(context.profile?.ranking?.constraintWeight || 0);
  return {
    ...ranked,
    constraintSignal: signedConstraintSignal,
    rankScore: ranked.rankScore
      + (signedConstraintSignal - ranked.constraintSignal) * constraintWeight
  };
}

function choiceKey(items) {
  return (items || []).map((item) => String(item.id)).sort().join('|');
}

function parentChoiceKey(state) {
  const items = state?.items || [];
  if (items.length < 2) return '';
  return choiceKey(items.slice(0, -1));
}

function parentChildRepresentatives(states, limit, context) {
  if (!states.length || limit <= 0) return [];
  const constraintKeys = new Set(positiveConstraintKeys(context.constraints));
  const baselineStats = constraintBaselineStats(context);
  const output = [];
  const seen = new Set();

  function push(state) {
    if (!state || output.length >= limit) return;
    const key = choiceKey(state.items);
    if (!key || seen.has(key)) return;
    seen.add(key);
    output.push(state);
  }

  const byObjective = [...states].sort((a, b) => b.objectiveScore - a.objectiveScore
    || b.score - a.score
    || choiceKey(a.items).localeCompare(choiceKey(b.items)));
  const byProxy = [...states].sort((a, b) => b.score - a.score
    || b.objectiveScore - a.objectiveScore
    || choiceKey(a.items).localeCompare(choiceKey(b.items)));
  push(byObjective[0]);
  push(byProxy[0]);

  for (const key of context.policy.paretoKeys || []) {
    if (output.length >= limit) break;
    const specialist = [...states]
      .filter((state) => retentionStat(state, key, constraintKeys, context.constraints, baselineStats) > 0)
      .sort((a, b) => retentionStat(b, key, constraintKeys, context.constraints, baselineStats)
        - retentionStat(a, key, constraintKeys, context.constraints, baselineStats)
        || b.objectiveScore - a.objectiveScore
        || b.score - a.score
        || choiceKey(a.items).localeCompare(choiceKey(b.items)))[0];
    push(specialist);
  }

  const diversified = keepChoiceDiversity(
    states,
    Math.min(states.length, limit),
    context,
    { preserveStructuralContributors: true }
  );
  for (const state of diversified) push(state);
  for (const state of byProxy) push(state);
  return output;
}

function preserveDofusParentChildDiversity(parentStates, states, retained, limit, context) {
  const targetCount = Math.min(Math.max(0, Number(limit || 0)), retained.length);
  if (targetCount <= 1 || !parentStates.length || !states.length || !retained.length) {
    return retained.slice(0, targetCount);
  }

  const reserveLimit = Math.min(Math.max(1, Math.floor(targetCount / 4)), targetCount - 1);
  if (reserveLimit <= 0) return retained.slice(0, targetCount);

  const retainedKeys = new Set(retained.map((state) => choiceKey(state.items)));
  const parentOrder = [];
  const seenParentKeys = new Set();
  function pushParentKey(parentKey) {
    if (!parentKey || seenParentKeys.has(parentKey)) return;
    seenParentKeys.add(parentKey);
    parentOrder.push(parentKey);
  }

  // Preserve the previous ordering for parents already represented by the
  // primary reduction, then append any retained pick-3 parents whose complete
  // child lineage disappeared. The parent set therefore comes from the real
  // previous beam instead of only from surviving pick-4 children.
  for (const state of retained) pushParentKey(parentChoiceKey(state));
  for (const state of parentStates) pushParentKey(choiceKey(state.items));

  const activeParentOrder = parentOrder;
  const perLaneLimit = reserveLimit;
  const childrenByParent = new Map(activeParentOrder.map((key) => [key, []]));
  for (const state of states) {
    const group = childrenByParent.get(parentChoiceKey(state));
    if (group) group.push(state);
  }

  const laneEntries = activeParentOrder.map((parentKey) => {
    const representatives = parentChildRepresentatives(
      childrenByParent.get(parentKey) || [],
      perLaneLimit,
      context
    );
    return {
      parentKey,
      representatives,
      lane: representatives.filter((state) => !retainedKeys.has(choiceKey(state.items)))
    };
  });

  // The primary beam already rewards absolute child quality. The protected
  // reserve instead evaluates each qualified representative by the opportunity
  // it creates relative to its exact retained parent. Reuse the existing
  // representative reducer on these marginal scores so the reserve stays
  // deterministic and bounded without introducing rank or item-specific quotas.
  const parentByKey = new Map(parentStates.map((state) => [choiceKey(state.items), state]));
  const marginalPool = [];
  const originalByKey = new Map();
  const representativeKeys = new Set();
  for (const entry of laneEntries) {
    const parent = parentByKey.get(entry.parentKey);
    if (!parent) continue;
    for (const state of entry.lane) {
      const key = choiceKey(state.items);
      if (!key || representativeKeys.has(key)) continue;
      representativeKeys.add(key);
      originalByKey.set(key, state);
      marginalPool.push({
        ...state,
        objectiveScore: Number(state.objectiveScore || 0) - Number(parent.objectiveScore || 0),
        score: Number(state.score || 0) - Number(parent.score || 0)
      });
    }
  }
  marginalPool.sort((a, b) => choiceKey(a.items).localeCompare(choiceKey(b.items)));
  const protectedStates = parentChildRepresentatives(marginalPool, reserveLimit, context)
    .map((state) => originalByKey.get(choiceKey(state.items)))
    .filter(Boolean);

  let output;
  if (!protectedStates.length) {
    output = retained.slice(0, targetCount);
  } else {
    const primaryCount = Math.max(0, targetCount - protectedStates.length);
    output = [];
    const outputKeys = new Set();
    function push(state) {
      if (output.length >= targetCount) return;
      const key = choiceKey(state.items);
      if (!key || outputKeys.has(key)) return;
      outputKeys.add(key);
      output.push(state);
    }

    for (const state of retained.slice(0, primaryCount)) push(state);
    for (const state of protectedStates) push(state);
    for (const state of retained) push(state);
  }

  const traceParentKey = String(context.traceParentKey || '');
  const traceChildKey = String(context.traceChildKey || '');
  if (typeof context.onDofusParentChildTrace === 'function' && traceParentKey && traceChildKey) {
    const oneBasedStateIndex = (list, targetKey) => {
      const index = list.findIndex((state) => choiceKey(state.items) === targetKey);
      return index >= 0 ? index + 1 : null;
    };
    const winnerPrimaryChildren = retained.filter((state) => parentChoiceKey(state) === traceParentKey);
    const winnerSiblings = childrenByParent.get(traceParentKey) || [];
    const winnerByObjective = [...winnerSiblings].sort((a, b) => b.objectiveScore - a.objectiveScore
      || b.score - a.score
      || choiceKey(a.items).localeCompare(choiceKey(b.items)));
    const winnerByProxy = [...winnerSiblings].sort((a, b) => b.score - a.score
      || b.objectiveScore - a.objectiveScore
      || choiceKey(a.items).localeCompare(choiceKey(b.items)));
    const winnerLaneEntry = laneEntries.find((entry) => entry.parentKey === traceParentKey);
    const winnerRepresentatives = winnerLaneEntry?.representatives || [];
    const representativeIndex = oneBasedStateIndex(winnerRepresentatives, traceChildKey);
    const protectedIndex = oneBasedStateIndex(protectedStates, traceChildKey);
    const parentOrderIndex = parentOrder.indexOf(traceParentKey);

    context.onDofusParentChildTrace({
      WINNER_PARENT_RETAINED_INDEX_AT_PICK3: oneBasedStateIndex(parentStates, traceParentKey),
      PICK3_RETAINED_PARENT_COUNT: parentStates.length,
      WINNER_PARENT_HAS_ANY_PRIMARY_CHILD_AT_PICK4: winnerPrimaryChildren.length > 0,
      WINNER_PARENT_PRIMARY_CHILD_COUNT: winnerPrimaryChildren.length,
      WINNER_PARENT_ORDER_IN_PARENT_LANES: parentOrderIndex >= 0 ? parentOrderIndex + 1 : null,
      TOTAL_PARENT_LANES: parentOrder.length,
      ACTIVE_PARENT_LANES: activeParentOrder.length,
      RESERVE_LIMIT: reserveLimit,
      PER_LANE_LIMIT: perLaneLimit,
      WINNER_PARENT_LANE_ACTIVE: activeParentOrder.includes(traceParentKey),
      WINNER_SIBLING_COUNT: winnerSiblings.length,
      WINNER_SIBLING_OBJECTIVE_RANK: oneBasedStateIndex(winnerByObjective, traceChildKey),
      WINNER_SIBLING_PROXY_RANK: oneBasedStateIndex(winnerByProxy, traceChildKey),
      WINNER_CHILD_PRESENT_IN_PARENT_CHILD_REPRESENTATIVES: representativeIndex !== null,
      WINNER_CHILD_REPRESENTATIVE_INDEX: representativeIndex,
      WINNER_CHILD_ENTERED_PROTECTED_STATES: protectedIndex !== null,
      WINNER_CHILD_PROTECTED_INDEX: protectedIndex,
      WINNER_CHILD_PRESENT_IN_PRIMARY_STATES: retainedKeys.has(traceChildKey),
      WINNER_CHILD_PRESENT_IN_FINAL_BEAM4: output.some((state) => choiceKey(state.items) === traceChildKey),
      BEAM4_RETAINED_COUNT: output.length
    });
  }

  return output;
}

function resourceBucket(state, constraints = {}, prysma = 0, constraintKeys = new Set(), baselineStats = BASE_CHARACTER.baseStats || {}) {
  const keys = [...new Set(['ap', 'mp', 'range', ...positiveConstraintKeys(constraints)])];
  const parts = keys.map((key) => {
    const value = Math.max(0, retentionStat(state, key, constraintKeys, constraints, baselineStats));
    const target = constraintKeys.has(key)
      ? constraintContributionTarget(key, constraints, baselineStats)
      : Math.max(0, Number(constraints?.[key] || 0));
    if (target > 0) return `${key}:${Math.min(4, Math.floor((value / target) * 4))}`;
    return `${key}:${Math.min(4, Math.round(value))}`;
  });
  return `${parts.join(',')}:p${prysma}`;
}

function keepChoiceDiversity(states, limit, context, { preserveStructuralContributors = false } = {}) {
  const seen = new Set();
  const output = [];
  const perBucket = new Map();
  const constraintKeys = new Set(positiveConstraintKeys(context.constraints));
  const baselineStats = constraintBaselineStats(context);

  function tryKeep(state, { enforceBucket = true } = {}) {
    if (output.length >= limit) return false;
    const key = choiceKey(state.items);
    if (!key || seen.has(key)) return false;
    const bucket = resourceBucket(state, context.constraints, state.prysma, constraintKeys, baselineStats);
    const used = perBucket.get(bucket) || 0;
    if (enforceBucket && used >= context.profile.search.groupBucketLimit) return false;
    seen.add(key);
    perBucket.set(bucket, used + 1);
    output.push(state);
    return true;
  }

  if (preserveStructuralContributors) {
    const structuralKeys = positiveConstraintKeys(context.constraints)
      .filter((key) => ['ap', 'mp', 'range'].includes(key));
    const optimisticByItem = new Map();
    const bestByContributor = new Map();
    for (const state of states) {
      for (const item of state.items || []) {
        let optimistic = optimisticByItem.get(item);
        if (!optimistic) {
          optimistic = optimisticItemStats(item, {
            includePassives: true,
            turnMode: context.turnMode,
            scenario: context.scenario
          }).stats;
          optimisticByItem.set(item, optimistic);
        }
        for (const key of structuralKeys) {
          if (!(num(optimistic, key) > 0)) continue;
          const contributorKey = `${key}:${String(item.id)}`;
          const previous = bestByContributor.get(contributorKey);
          if (!previous
            || state.objectiveScore > previous.objectiveScore
            || (state.objectiveScore === previous.objectiveScore && state.score > previous.score)) {
            bestByContributor.set(contributorKey, state);
          }
        }
      }
    }
    const representatives = [...new Set(bestByContributor.values())]
      .sort((a, b) => b.objectiveScore - a.objectiveScore
        || b.score - a.score
        || choiceKey(a.items).localeCompare(choiceKey(b.items)));
    for (const state of representatives) {
      if (output.length >= limit) break;
      tryKeep(state, { enforceBucket: false });
    }
  }

  // Preserve a tiny lane for each context-relevant Pareto dimension. This is
  // especially important for multiplicative specialists (for example % spell
  // damage): they can look weak in isolation but become optimal once combined
  // with the stats supplied by the rest of the build.
  const specialistReserve = Math.max(0, Number(context.profile.search.groupSpecialistReservePerStat || 0));
  for (const key of context.policy.paretoKeys || []) {
    if (output.length >= limit || specialistReserve <= 0) break;
    const bySpecialist = [...states]
      .filter((state) => retentionStat(state, key, constraintKeys, context.constraints, baselineStats) > 0)
      .sort((a, b) => retentionStat(b, key, constraintKeys, context.constraints, baselineStats) - retentionStat(a, key, constraintKeys, context.constraints, baselineStats)
        || b.objectiveScore - a.objectiveScore
        || b.score - a.score);
    let kept = 0;
    for (const state of bySpecialist) {
      if (tryKeep(state, { enforceBucket: false })) kept++;
      if (kept >= specialistReserve || output.length >= limit) break;
    }
  }

  const offenseReserve = Math.min(
    Math.max(0, limit - output.length),
    Math.max(0, Number(context.profile.search.groupOffenseReserve || 0))
  );
  const offenseTarget = output.length + offenseReserve;
  const byOffense = [...states].sort((a, b) => b.objectiveScore - a.objectiveScore || b.score - a.score);
  for (const state of byOffense) {
    if (output.length >= offenseTarget) break;
    tryKeep(state, { enforceBucket: false });
  }

  const ordered = [...states].sort((a, b) => b.score - a.score || b.objectiveScore - a.objectiveScore);
  for (const state of ordered) {
    if (output.length >= limit) break;
    tryKeep(state, { enforceBucket: true });
  }
  return output;
}

export function buildGroupChoices(profiles = [], count = 1, context = {}) {
  if (count <= 0) return [{ items: [], score: 0, objectiveScore: 0, optimisticStats: {}, bounded: true, prysma: 0 }];
  if (profiles.length < count) return [];
  const constrainedKeys = positiveConstraintKeys(context.constraints);
  if (count === 1) {
    return profiles
      .map((entry) => {
        const constraintStats = {};
        addSignedConstraintStats(constraintStats, entry, constrainedKeys);
        const ranked = rankGroupState(entry.optimisticStats, constraintStats, context);
        return {
          items: [entry.item],
          score: ranked.rankScore,
          objectiveScore: ranked.objectiveGain,
          optimisticStats: { ...entry.optimisticStats },
          bounded: entry.bounded,
          prysma: isPrysmaradite(entry.item) ? 1 : 0
        };
      })
      .sort((a, b) => b.score - a.score || String(a.items[0].id).localeCompare(String(b.items[0].id)));
  }

  const profile = context.profile;
  const beamWidth = context.slot === 'dofus'
    ? profile.search.dofusGroupBeamWidth
    : count >= 5 ? profile.search.multiPickBeamWidth : profile.search.groupBeamWidth;
  let states = [{
    items: [],
    score: 0,
    objectiveScore: 0,
    next: 0,
    prysma: 0,
    optimisticStats: {},
    constraintStats: {},
    bounded: true
  }];
  for (let pick = 0; pick < count; pick++) {
    const parentStates = states;
    const next = [];
    const leftAfter = count - pick - 1;
    for (const state of parentStates) {
      const last = profiles.length - leftAfter;
      for (let index = state.next; index < last; index++) {
        const candidate = profiles[index];
        const prysma = state.prysma + (isPrysmaradite(candidate.item) ? 1 : 0);
        if (prysma > 1) continue;
        const stats = { ...state.optimisticStats };
        addPositive(stats, candidate.optimisticStats);
        const constraintStats = { ...state.constraintStats };
        addSignedConstraintStats(constraintStats, candidate, constrainedKeys);
        const combinedRank = rankGroupState(stats, constraintStats, context);
        next.push({
          items: [...state.items, candidate.item],
          score: combinedRank.rankScore,
          objectiveScore: combinedRank.objectiveGain,
          next: index + 1,
          prysma,
          optimisticStats: stats,
          constraintStats,
          bounded: state.bounded && candidate.bounded
        });
      }
    }
    const primaryStates = keepChoiceDiversity(next, beamWidth, context);
    states = context.slot === 'dofus' && pick >= 3
      ? preserveDofusParentChildDiversity(parentStates, next, primaryStates, beamWidth, context)
      : primaryStates;
    if (!states.length) break;
  }

  const softLimit = Math.max(count, Number(profile.search.groupChoiceLimits?.[context.slot] || states.length));
  const diversityLimit = Math.max(
    softLimit,
    Math.min(states.length, profile.search.groupBucketLimit * profile.search.groupDiversityMultiplier)
  );
  return keepChoiceDiversity(states, diversityLimit, context, { preserveStructuralContributors: true })
    .map(({ items, score, objectiveScore, optimisticStats, bounded, prysma }) => ({
      items, score, objectiveScore, optimisticStats, bounded, prysma
    }));
}

export function staticBuildStats(items = [], setsById = {}) {
  const stats = emptyStats();
  addStats(stats, BASE_CHARACTER.baseStats || {});
  for (const item of items) addStats(stats, item.stats || {});
  applySetBonuses(stats, items, setsById);
  return stats;
}

function characteristicUpperAllowance(key) {
  if (key === 'vit') return Math.max(0, Number(BASE_CHARACTER.characteristicPoints || 0));
  if (['earth', 'fire', 'water', 'air'].includes(key)) {
    return Math.max(0, Number(BASE_CHARACTER.scrolled?.[key] || 0))
      + Math.max(0, Number(BASE_CHARACTER.characteristicPoints || 0));
  }
  return 0;
}

function positiveSetBonusCaps(sets = [], keys = []) {
  const result = Object.fromEntries(keys.map((key) => [key, 0]));
  for (const set of sets || []) {
    for (const key of keys) {
      let best = 0;
      for (const bonus of Object.values(set?.bonuses || {})) best = Math.max(best, Math.max(0, num(bonus, key)));
      result[key] += best;
    }
  }
  return result;
}

function remainingProfileCaps(groups = [], profilesFor, keys = []) {
  const caps = Object.fromEntries(keys.map((key) => [key, 0]));
  for (const group of groups) {
    const profiles = profilesFor(group.id) || [];
    const count = Math.max(0, Number(group.missing || 0));
    if (profiles.length < count) return { caps, bounded: true, impossibleShape: true };
    if (profiles.some((entry) => entry.bounded === false)) return { caps, bounded: false, impossibleShape: false };
    for (const key of keys) {
      const values = profiles
        .map((entry) => Math.max(0, num(entry.optimisticStats, key)))
        .sort((a, b) => b - a);
      for (let index = 0; index < count; index++) caps[key] += Number(values[index] || 0);
    }
  }
  return { caps, bounded: true, impossibleShape: false };
}

export function createBranchFeasibilityEnvelope({
  remainingGroups = [],
  profilesFor,
  constraints = {},
  sets = []
} = {}) {
  const keys = positiveConstraintKeys(constraints);
  if (!keys.length) {
    return {
      keys,
      remaining: { caps: {}, bounded: true, impossibleShape: false },
      setCaps: {}
    };
  }
  return {
    keys,
    remaining: remainingProfileCaps(remainingGroups, profilesFor, keys),
    setCaps: positiveSetBonusCaps(sets, keys)
  };
}

function cachedBranchFeasibilityEnvelope({ remainingGroups, profilesFor, constraints, sets }) {
  if (!remainingGroups || typeof remainingGroups !== 'object') {
    return createBranchFeasibilityEnvelope({ remainingGroups, profilesFor, constraints, sets });
  }
  let entries = branchEnvelopeCache.get(remainingGroups);
  if (!entries) {
    entries = [];
    branchEnvelopeCache.set(remainingGroups, entries);
  }
  const match = entries.find((entry) => entry.profilesFor === profilesFor
    && entry.constraints === constraints
    && entry.sets === sets);
  if (match) return match.value;
  const value = createBranchFeasibilityEnvelope({ remainingGroups, profilesFor, constraints, sets });
  entries.push({ profilesFor, constraints, sets, value });
  return value;
}

export function branchFeasibility({
  items = [],
  remainingGroups = [],
  profilesFor,
  constraints = {},
  fmPolicy = {},
  sets = [],
  setsById = {},
  currentStats = null,
  envelope = null
} = {}) {
  const prepared = envelope || cachedBranchFeasibilityEnvelope({ remainingGroups, profilesFor, constraints, sets });
  const keys = prepared.keys || [];
  if (!keys.length) return { feasible: true, key: null, actual: 0, maximum: Infinity, target: 0 };
  const current = currentStats || staticBuildStats(items, setsById);
  const remaining = prepared.remaining;
  if (remaining.impossibleShape) return { feasible: false, key: 'shape', actual: 0, maximum: 0, target: 1 };
  if (!remaining.bounded) return { feasible: true, key: null, actual: 0, maximum: Infinity, target: 0 };
  const setCaps = prepared.setCaps || {};
  for (const key of keys) {
    const target = Number(constraints[key] || 0);
    const explicitStructuralExo = key === 'ap' && Number(fmPolicy?.exoAp) === 1
      ? 1
      : key === 'mp' && Number(fmPolicy?.exoMp) === 1
        ? 1
        : 0;
    const actual = num(current, key) + explicitStructuralExo + characteristicUpperAllowance(key);
    const maximum = actual + Number(remaining.caps[key] || 0) + Number(setCaps[key] || 0);
    if (maximum + 1e-9 < target) return { feasible: false, key, actual, maximum, target };
  }
  return { feasible: true, key: null, actual: 0, maximum: Infinity, target: 0 };
}

function optimisticCurrentStats(items, context) {
  const stats = {};
  addPositive(stats, BASE_CHARACTER.baseStats || {});
  for (const element of ['earth', 'fire', 'water', 'air']) {
    stats[element] = Number(stats[element] || 0) + Math.max(0, Number(BASE_CHARACTER.scrolled?.[element] || 0));
  }
  let bounded = true;
  for (const item of items || []) {
    const optimistic = optimisticItemStats(item, {
      includePassives: true,
      turnMode: context.turnMode,
      scenario: context.scenario
    });
    bounded = bounded && optimistic.bounded;
    addPositive(stats, optimistic.stats);
  }
  return { stats, bounded };
}

function forgeableSlotCount() {
  return SLOT_RULES.reduce((sum, rule) => sum + (FM_ELIGIBLE_SLOTS.has(rule.id) ? Number(rule.count || 0) : 0), 0);
}

function offensiveEnvelope({ remainingGroups, profilesFor, policy, sets }) {
  let entries = offensiveEnvelopeCache.get(remainingGroups);
  if (!entries) {
    entries = [];
    offensiveEnvelopeCache.set(remainingGroups, entries);
  }
  const match = entries.find((entry) => entry.profilesFor === profilesFor
    && entry.policy === policy
    && entry.sets === sets);
  if (match) return match.value;

  const relevant = new Set([
    ...policy.paretoKeys,
    ...GENERIC_OFFENSE_KEYS,
    ...policy.elements,
    ...policy.elements.map((element) => `damage${element[0].toUpperCase()}${element.slice(1)}`)
  ]);
  const keys = [...relevant];
  const value = {
    remaining: remainingProfileCaps(remainingGroups, profilesFor, keys),
    setCaps: positiveSetBonusCaps(sets, keys),
    forgeable: forgeableSlotCount()
  };
  entries.push({ profilesFor, policy, sets, value });
  return value;
}

export function offensiveUpperBound({
  items = [],
  remainingGroups = [],
  profilesFor,
  policy,
  sets = [],
  fmPolicy = {}
} = {}) {
  const current = optimisticCurrentStats(items, policy);
  const envelope = offensiveEnvelope({ remainingGroups, profilesFor, policy, sets });
  const remaining = envelope.remaining;
  if (!current.bounded || !remaining.bounded || remaining.impossibleShape) return Infinity;
  for (const [key, value] of Object.entries(remaining.caps)) {
    current.stats[key] = Number(current.stats[key] || 0) + Number(value || 0);
  }
  addPositive(current.stats, envelope.setCaps);

  const activeElements = policy.elements.length ? policy.elements : ['earth', 'fire', 'water', 'air'];
  for (const element of activeElements) {
    current.stats[element] = Number(current.stats[element] || 0)
      + Math.max(0, Number(BASE_CHARACTER.characteristicPoints || 0));
  }

  current.stats.spellDamagePct = Number(current.stats.spellDamagePct || 0)
    + envelope.forgeable * Math.max(0, Number(fmPolicy?.spellDamagePct || 0));
  current.stats.critDamage = Number(current.stats.critDamage || 0)
    + envelope.forgeable * Math.max(0, Number(fmPolicy?.critDamageAmount ?? 8));
  current.stats.crit = Number(current.stats.crit || 0) + 100;

  const value = evaluateObjectiveUpperBound({
    stats: current.stats,
    selections: policy.selections,
    turnMode: policy.turnMode
  }).score;
  return Number.isFinite(value) ? value : Infinity;
}

export function fastPartialRank(items = [], policy, setsById = {}) {
  const stats = staticBuildStats(items, setsById);
  return policy.rankStats(stats).rankScore;
}
