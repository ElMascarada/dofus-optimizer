import { SLOT_RULES } from './config.js';
import { addStats, effectiveStat, emptyStats } from './stats.js';
import { applySetBonuses } from './sets.js';
import { specialSlotRulesAreValid } from './build-legality.js';
import {
  compareCompleteEquipmentBuildResults,
  evaluateCompleteEquipmentBuild
} from './complete-equipment-build-evaluator.js';
import {
  buildEquipmentCandidatePools,
  positiveEquipmentConstraintKeys
} from '../optimizer/equipment-candidate-policy.js';
import { getSearchProfile } from '../optimizer/search-profiles.js';
import {
  filterOptimizerEligibleItems,
  optimizerTrophyEligibilityCounts
} from '../optimizer/item-eligibility.js';

function itemKey(items = []) {
  return items.map((item) => String(item?.id ?? '')).sort().join('|');
}

function setsByIdFor(sets = []) {
  return Object.fromEntries((sets || []).map((set) => [set.id, set]));
}

function staticStats(items = [], setsById = {}) {
  const stats = emptyStats();
  for (const item of items || []) addStats(stats, item?.stats || {});
  applySetBonuses(stats, items, setsById);
  return stats;
}

function slotCounts(items = []) {
  const counts = new Map();
  for (const item of items || []) counts.set(item?.slot, (counts.get(item?.slot) || 0) + 1);
  return counts;
}

function fullShape(items = []) {
  const counts = slotCounts(items);
  return SLOT_RULES.every((rule) => Number(counts.get(rule.id) || 0) === Number(rule.count || 0))
    && specialSlotRulesAreValid(items);
}

function requiredConstraint(items = [], requiredItemIds = []) {
  const byId = new Map(items.map((item) => [String(item.id), item]));
  const ids = [...new Set((requiredItemIds || []).map(String).filter(Boolean))];
  const requiredItems = ids.map((id) => byId.get(id)).filter(Boolean);
  const missingIds = ids.filter((id) => !byId.has(id));
  const counts = slotCounts(requiredItems);
  const overfilledSlots = SLOT_RULES
    .filter((rule) => Number(counts.get(rule.id) || 0) > Number(rule.count || 0))
    .map((rule) => rule.id);
  return {
    ids,
    requiredItems,
    missingIds,
    overfilledSlots,
    valid: !missingIds.length && !overfilledSlots.length && specialSlotRulesAreValid(requiredItems)
  };
}

function rankItems(items, policy, setsById) {
  const stats = staticStats(items, setsById);
  const ranked = policy.rankStats(stats);
  return { stats, ...ranked };
}

function constraintProgress(stats = {}, constraints = {}) {
  let coverage = 0;
  const signature = [];
  for (const key of positiveEquipmentConstraintKeys(constraints)) {
    const target = Math.max(1, Number(constraints[key] || 0));
    const ratio = Math.min(1, Math.max(0, effectiveStat(stats, key)) / target);
    coverage += ratio;
    signature.push(`${key}:${Math.min(4, Math.floor(ratio * 4))}`);
  }
  return { coverage, signature: signature.join(',') };
}

function setSignature(items = []) {
  const counts = new Map();
  for (const item of items) if (item?.setId) counts.set(item.setId, (counts.get(item.setId) || 0) + 1);
  return [...counts.entries()]
    .filter(([, count]) => count >= 2)
    .sort(([a], [b]) => String(a).localeCompare(String(b)))
    .map(([id, count]) => `${id}:${Math.min(4, count)}`)
    .join(',');
}

function stateBucket(state, constraints = {}) {
  const progress = constraintProgress(state.stats, constraints);
  return `${Math.min(12, effectiveStat(state.stats, 'ap'))}:${Math.min(6, effectiveStat(state.stats, 'mp'))}:${progress.signature}:${setSignature(state.items)}`;
}

function keepEquipmentDiversity(states, limit, { policy, constraints, bucketLimit = 10 } = {}) {
  if (states.length <= limit) return states;
  const ranked = [...states].sort((a, b) => b.rankScore - a.rankScore || itemKey(a.items).localeCompare(itemKey(b.items)));
  const output = [];
  const seen = new Set();
  const perBucket = new Map();

  function keep(state, enforceBucket = true) {
    if (!state || output.length >= limit) return false;
    const key = itemKey(state.items);
    if (seen.has(key)) return false;
    const bucket = stateBucket(state, constraints);
    const used = perBucket.get(bucket) || 0;
    if (enforceBucket && used >= bucketLimit) return false;
    seen.add(key);
    perBucket.set(bucket, used + 1);
    output.push(state);
    return true;
  }

  const specialistReserve = Math.max(1, Number(policy.profile.search.groupSpecialistReservePerStat || 1));
  for (const statKey of policy.paretoKeys || []) {
    const specialists = [...states]
      .filter((state) => effectiveStat(state.stats, statKey) > 0)
      .sort((a, b) => effectiveStat(b.stats, statKey) - effectiveStat(a.stats, statKey)
        || b.rankScore - a.rankScore
        || itemKey(a.items).localeCompare(itemKey(b.items)))
      .slice(0, specialistReserve);
    for (const state of specialists) keep(state, false);
  }

  const setIds = new Set(states.flatMap((state) => state.items.map((item) => item?.setId).filter(Boolean)));
  for (const setId of [...setIds].sort()) {
    const representative = [...states]
      .filter((state) => state.items.filter((item) => item?.setId === setId).length >= 2)
      .sort((a, b) => b.items.filter((item) => item?.setId === setId).length
        - a.items.filter((item) => item?.setId === setId).length
        || b.rankScore - a.rankScore
        || itemKey(a.items).localeCompare(itemKey(b.items)))[0];
    keep(representative, false);
  }

  for (const state of ranked) keep(state, true);
  for (const state of ranked) keep(state, false);
  return output;
}

function buildGroupChoices(profiles = [], count = 1, context = {}) {
  if (count <= 0) return [{ items: [], stats: {}, rankScore: 0 }];
  let states = [{ items: [], ids: new Set(), stats: {}, rankScore: 0 }];
  const limit = Math.max(
    Number(context.profile.search.groupChoiceLimits?.[context.slot] || 1),
    Number(context.profile.search.groupBeamWidth || 1)
  );
  for (let pick = 0; pick < count; pick++) {
    const next = [];
    for (const state of states) {
      for (const entry of profiles) {
        const id = String(entry.item.id);
        if (state.ids.has(id)) continue;
        const items = [...state.items, entry.item];
        if (!specialSlotRulesAreValid(items)) continue;
        const ranked = rankItems(items, context.policy, context.setsById);
        next.push({
          items,
          ids: new Set([...state.ids, id]),
          stats: ranked.stats,
          rankScore: ranked.rankScore
        });
      }
    }
    const dedup = new Map();
    for (const state of next) {
      const key = itemKey(state.items);
      const previous = dedup.get(key);
      if (!previous || state.rankScore > previous.rankScore) dedup.set(key, state);
    }
    states = keepEquipmentDiversity([...dedup.values()], limit, {
      policy: context.policy,
      constraints: context.constraints,
      bucketLimit: context.profile.search.groupBucketLimit
    });
    if (!states.length) break;
  }
  return states
    .sort((a, b) => b.rankScore - a.rankScore || itemKey(a.items).localeCompare(itemKey(b.items)))
    .slice(0, Number(context.profile.search.groupChoiceLimits?.[context.slot] || states.length));
}

function insertTop(results, candidate, topN) {
  if (!candidate) return;
  const key = candidate.buildIdentity;
  const previous = results.findIndex((entry) => entry.buildIdentity === key);
  if (previous >= 0) results.splice(previous, 1);
  results.push(candidate);
  results.sort((a, b) => -compareCompleteEquipmentBuildResults(a, b));
  if (results.length > topN) results.length = topN;
}

function impossibleResult(required, trophyEligibility) {
  return {
    results: [],
    candidateItems: [],
    candidatePools: {},
    diagnostics: {
      mode: 'equipment-search-v2',
      impossible: true,
      reason: required.missingIds.length
        ? 'required-item-missing'
        : required.overfilledSlots.length ? 'required-slot-overflow' : 'required-special-slot-rule',
      requiredItemIds: required.ids,
      trophyEligibility,
      expandedStates: 0,
      completeStates: 0,
      evaluated: 0,
      valid: 0,
      heuristicTrimmed: 0,
      safePruned: 0,
      syntheticBoundUsed: false
    }
  };
}

export function searchEquipmentArchitecturesV2({
  items = [],
  sets = [],
  constraints = {},
  fmPolicy = {},
  syntheticOffense = {},
  requiredItemIds = [],
  topN = 10,
  searchProfile = 'BALANCED',
  onProgress = null,
  onDiagnostics = null
} = {}) {
  const trophyEligibility = optimizerTrophyEligibilityCounts(items);
  const eligibleItems = filterOptimizerEligibleItems(items);
  const required = requiredConstraint(eligibleItems, requiredItemIds);
  if (!required.valid) return impossibleResult(required, trophyEligibility);

  const profile = getSearchProfile(searchProfile);
  const prefilter = buildEquipmentCandidatePools({
    items: eligibleItems,
    sets,
    constraints,
    fmPolicy,
    syntheticOffense,
    requiredItemIds: required.ids,
    searchProfile: profile
  });
  const policy = prefilter.policy;
  const setsById = setsByIdFor(sets);
  const requiredIds = new Set(required.ids);
  const requiredCounts = slotCounts(required.requiredItems);
  const choiceCache = new Map();

  function choicesFor(rule) {
    const missing = Number(rule.count || 0) - Number(requiredCounts.get(rule.id) || 0);
    if (missing <= 0) return [{ items: [], stats: {}, rankScore: 0 }];
    const cacheKey = `${rule.id}:${missing}`;
    if (choiceCache.has(cacheKey)) return choiceCache.get(cacheKey);
    const profiles = (prefilter.pools?.[rule.id] || [])
      .filter((item) => !requiredIds.has(String(item.id)))
      .map((item) => policy.profileItem(item));
    const choices = buildGroupChoices(profiles, missing, {
      slot: rule.id,
      policy,
      profile,
      constraints,
      setsById
    });
    choiceCache.set(cacheKey, choices);
    return choices;
  }

  const groups = SLOT_RULES
    .map((rule) => ({ ...rule, missing: Number(rule.count || 0) - Number(requiredCounts.get(rule.id) || 0) }))
    .filter((rule) => rule.missing > 0)
    .sort((a, b) => {
      if (a.id === 'dofus' && b.id !== 'dofus') return -1;
      if (b.id === 'dofus' && a.id !== 'dofus') return 1;
      return choicesFor(a).length - choicesFor(b).length;
    });

  const initialRank = rankItems(required.requiredItems, policy, setsById);
  let states = [{
    items: [...required.requiredItems],
    ids: new Set(required.ids),
    stats: initialRank.stats,
    rankScore: initialRank.rankScore
  }];
  let expandedStates = 0;
  let heuristicTrimmed = 0;
  let safePruned = 0;
  const trace = [{ stage: 'raw-eligible-catalog', count: eligibleItems.length }, { stage: 'candidate-pool', count: prefilter.items.length }];

  for (const group of groups) {
    const choices = choicesFor(group);
    const next = [];
    for (const state of states) {
      for (const choice of choices) {
        if (choice.items.some((item) => state.ids.has(String(item.id)))) continue;
        const nextItems = [...state.items, ...choice.items];
        if (!specialSlotRulesAreValid(nextItems)) {
          safePruned++;
          continue;
        }
        const ranked = rankItems(nextItems, policy, setsById);
        const progress = constraintProgress(ranked.stats, constraints);
        next.push({
          items: nextItems,
          ids: new Set([...state.ids, ...choice.items.map((item) => String(item.id))]),
          stats: ranked.stats,
          rankScore: ranked.rankScore + progress.coverage * Number(profile.ranking.constraintProgressWeight || 0)
        });
        expandedStates++;
      }
    }
    const stateLimit = group.id === 'dofus' ? profile.search.dofusStateBeamWidth : profile.search.stateBeamWidth;
    const kept = keepEquipmentDiversity(next, stateLimit, {
      policy,
      constraints,
      bucketLimit: profile.search.stateBucketLimit
    });
    heuristicTrimmed += Math.max(0, next.length - kept.length);
    states = kept;
    trace.push({ stage: `beam:${group.id}`, before: next.length, count: states.length });
    if (typeof onProgress === 'function') {
      onProgress({
        phase: 'equipment-search-v2',
        label: group.id,
        nodes: expandedStates,
        visited: states.length,
        pruned: safePruned,
        heuristicTrimmed,
        best: states[0]?.rankScore || 0
      });
    }
    if (!states.length) break;
  }

  const complete = states.filter((state) => fullShape(state.items));
  trace.push({ stage: 'complete-states', count: complete.length });
  const evaluationLimit = positiveEquipmentConstraintKeys(constraints).some((key) => !['ap', 'mp'].includes(key))
    ? profile.search.constrainedEvaluationLimit
    : profile.search.evaluationLimit;
  const rankedComplete = [...complete].sort((a, b) => b.rankScore - a.rankScore || itemKey(a.items).localeCompare(itemKey(b.items)));
  const evaluationPool = keepEquipmentDiversity(rankedComplete, Math.max(evaluationLimit, topN), {
    policy,
    constraints,
    bucketLimit: profile.search.stateBucketLimit
  });
  heuristicTrimmed += Math.max(0, complete.length - evaluationPool.length);
  trace.push({ stage: 'complete-evaluation-pool', count: evaluationPool.length });

  const results = [];
  const rejected = {};
  let evaluated = 0;
  let valid = 0;
  for (const state of evaluationPool) {
    const evaluation = evaluateCompleteEquipmentBuild({
      items: state.items,
      sets,
      constraints,
      fmPolicy,
      syntheticOffense
    });
    evaluated++;
    if (!evaluation.result) {
      const reason = evaluation.reason || 'unknown';
      rejected[reason] = Number(rejected[reason] || 0) + 1;
      continue;
    }
    valid++;
    insertTop(results, evaluation.result, Math.max(1, Number(topN || 10)));
  }
  trace.push({ stage: 'final-topN', count: results.length, identities: results.map((result) => result.buildIdentity) });
  if (typeof onDiagnostics === 'function') onDiagnostics({ trace: trace.map((entry) => ({ ...entry })) });

  return {
    results,
    candidateItems: prefilter.items,
    candidatePools: prefilter.pools,
    diagnostics: {
      mode: 'equipment-search-v2',
      searchProfile: typeof searchProfile === 'string' ? String(searchProfile).toUpperCase() : 'CUSTOM',
      requiredItemIds: required.ids,
      syntheticElements: [...policy.elements],
      syntheticProfiles: [...new Set((syntheticOffense?.profiles || []).map((value) => String(value).toLowerCase()))],
      constrainedStats: positiveEquipmentConstraintKeys(constraints),
      candidateCount: prefilter.items.length,
      completeStates: complete.length,
      evaluated,
      valid,
      expandedStates,
      safePruned,
      heuristicTrimmed,
      rejected,
      prefilter: prefilter.diagnostics,
      trophyEligibility,
      syntheticBoundUsed: false,
      boundStatesChecked: 0,
      falseNegativeBound: 0,
      trace
    }
  };
}
