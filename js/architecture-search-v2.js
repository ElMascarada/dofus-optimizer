import { BASE_CHARACTER, SLOT_RULES } from './config.js';
import { prefilterItems } from './candidate-prefilter.js';
import { buildSetSynergyIndex } from './set-synergy-index.js';
import { evaluateCompleteBuild } from './complete-build-evaluator.js';
import { specialSlotRulesAreValid } from './build-legality.js';
import {
  constraintProgressForStats,
  positiveConstraintKeys
} from '../optimizer/candidate-policy.js';
import {
  branchFeasibility,
  buildGroupChoices,
  fastPartialRank,
  offensiveUpperBound,
  staticBuildStats
} from '../optimizer/candidate-search.js';
import { getSearchProfile } from '../optimizer/search-profiles.js';
import {
  filterOptimizerEligibleItems,
  optimizerTrophyEligibilityCounts
} from '../optimizer/item-eligibility.js';

function num(stats, key) {
  const value = Number(stats?.[key] || 0);
  return Number.isFinite(value) ? value : 0;
}

function resultKey(result) {
  return (result?.items || []).map((item) => String(item.id)).sort().join('|');
}

function insertTop(results, result, limit) {
  if (!result?.items?.length) return;
  const key = resultKey(result);
  const previous = results.findIndex((entry) => resultKey(entry) === key);
  if (previous >= 0) {
    if (results[previous].score >= result.score) return;
    results.splice(previous, 1);
  }
  results.push(result);
  results.sort((a, b) => b.score - a.score);
  if (results.length > limit) results.length = limit;
}

function slotCounts(items) {
  const counts = new Map();
  for (const item of items || []) counts.set(item.slot, (counts.get(item.slot) || 0) + 1);
  return counts;
}

function slotCapacity(slot) {
  return Number(SLOT_RULES.find((rule) => rule.id === slot)?.count || 0);
}

function requiredConstraint(items, requiredItemIds = []) {
  const originalById = new Map((items || []).map((item) => [String(item.id), item]));
  const ids = [...new Set((requiredItemIds || []).map(String).filter(Boolean))];
  const missingIds = ids.filter((id) => !originalById.has(id));
  const requiredItems = ids.map((id) => originalById.get(id)).filter(Boolean);
  const counts = slotCounts(requiredItems);
  const overfilledSlots = [...counts.entries()]
    .filter(([slot, count]) => count > slotCapacity(slot))
    .map(([slot]) => slot);
  return {
    ids,
    requiredItems,
    missingIds,
    overfilledSlots,
    valid: !missingIds.length && !overfilledSlots.length && specialSlotRulesAreValid(requiredItems)
  };
}

function mergeRequiredAnchors(requiredItems, optionalItems = []) {
  const output = [...requiredItems];
  const ids = new Set(output.map((item) => String(item.id)));
  const counts = slotCounts(output);
  for (const item of optionalItems) {
    const id = String(item.id);
    if (ids.has(id)) continue;
    const current = counts.get(item.slot) || 0;
    if (current >= slotCapacity(item.slot)) continue;
    const candidate = [...output, item];
    if (!specialSlotRulesAreValid(candidate)) continue;
    output.push(item);
    ids.add(id);
    counts.set(item.slot, current + 1);
  }
  return output;
}

function fullShape(items) {
  const counts = slotCounts(items);
  return SLOT_RULES.every((rule) => (counts.get(rule.id) || 0) === Number(rule.count || 0))
    && specialSlotRulesAreValid(items);
}

function mutationVariants(architecture, limit) {
  if (!architecture) return [{ label: 'standalones', anchorIds: [] }];
  const baseIds = [...new Set(architecture.plans.flatMap((plan) => plan.memberIds || []).map(String))];
  const scoreById = new Map();
  for (const plan of architecture.plans) {
    (plan.memberIds || []).forEach((id, index) => scoreById.set(String(id), Number(plan.memberScores?.[index] || 0)));
  }
  const variants = [{ label: architecture.key, anchorIds: baseIds }];
  for (const plan of architecture.plans) {
    if (Number(plan.targetCount || 0) < 3) continue;
    const weakest = [...(plan.memberIds || [])]
      .map(String)
      .sort((a, b) => (scoreById.get(a) || 0) - (scoreById.get(b) || 0))[0];
    if (weakest) variants.push({ label: `${architecture.key} · -1 ${plan.name}`, anchorIds: baseIds.filter((id) => id !== weakest) });
  }
  const weakest = [...baseIds].sort((a, b) => (scoreById.get(a) || 0) - (scoreById.get(b) || 0));
  if (weakest.length >= 2) {
    const removed = new Set(weakest.slice(0, 2));
    variants.push({ label: `${architecture.key} · -2 standalones`, anchorIds: baseIds.filter((id) => !removed.has(id)) });
  }
  const seen = new Set();
  return variants.filter((variant) => {
    const key = [...variant.anchorIds].sort().join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, limit);
}

function impossibleRequiredResult(required) {
  return {
    results: [],
    candidateItems: [],
    candidatePools: {},
    diagnostics: {
      mode: 'architecture-search-v2',
      searchModes: ['set-core', 'standalone'],
      impossible: true,
      reason: required.missingIds.length
        ? 'required-item-missing'
        : required.overfilledSlots.length ? 'required-slot-overflow' : 'required-special-slot-rule',
      requiredItemIds: required.ids,
      missingRequiredItemIds: required.missingIds,
      overfilledRequiredSlots: required.overfilledSlots,
      evaluated: 0,
      valid: 0,
      evaluatedByOrigin: { 'set-core': 0, standalone: 0 },
      validByOrigin: { 'set-core': 0, standalone: 0 },
      bestByOrigin: { 'set-core': null, standalone: null },
      expandedStates: 0,
      safePruned: 0,
      heuristicTrimmed: 0,
      nodes: 0,
      visited: 0,
      pruned: 0
    }
  };
}

function progressStats(items, setsById, constraints, fmPolicy = {}) {
  const stats = staticBuildStats(items, setsById);
  if (Number(fmPolicy?.exoAp) === 1) stats.ap = num(stats, 'ap') + 1;
  if (Number(fmPolicy?.exoMp) === 1) stats.mp = num(stats, 'mp') + 1;
  if (Number(constraints?.vit || 0) > 0) stats.vit = num(stats, 'vit') + Math.max(0, Number(BASE_CHARACTER.characteristicPoints || 0));
  for (const element of ['earth', 'fire', 'water', 'air']) {
    if (Number(constraints?.[element] || 0) <= 0) continue;
    stats[element] = num(stats, element)
      + Math.max(0, Number(BASE_CHARACTER.scrolled?.[element] || 0))
      + Math.max(0, Number(BASE_CHARACTER.characteristicPoints || 0));
  }
  return stats;
}

function stateBucket(state, context) {
  const stats = progressStats(state.items, context.setsById, context.constraints, context.fmPolicy);
  const progress = constraintProgressForStats(stats, context.constraints);
  const setCounts = new Map();
  for (const item of state.items) if (item.setId) setCounts.set(item.setId, (setCounts.get(item.setId) || 0) + 1);
  const setSignature = [...setCounts.entries()]
    .filter(([, count]) => count >= 2)
    .sort(([a], [b]) => String(a).localeCompare(String(b)))
    .map(([id, count]) => `${id}:${Math.min(count, 4)}`)
    .join(',');
  return `${Math.min(num(stats, 'ap'), 14)}:${Math.min(num(stats, 'mp'), 8)}:${progress.signature}:${setSignature}`;
}

function dofusLineageKey(state) {
  const ids = (state?.items || [])
    .filter((item) => item?.slot === 'dofus')
    .map((item) => String(item.id))
    .sort();
  return ids.length ? ids.join('|') : null;
}

export function keepDiverseStates(states, context, limit) {
  for (const state of states) {
    const stats = progressStats(state.items, context.setsById, context.constraints, context.fmPolicy);
    const progress = constraintProgressForStats(stats, context.constraints);
    state.searchStats = stats;
    state.searchRank = state.heuristic
      + fastPartialRank(state.items, context.policy, context.setsById)
      + progress.coverage * context.profile.ranking.constraintProgressWeight;
    state.constraintReady = progress.ready;
  }
  states.sort((a, b) => Number(b.constraintReady) - Number(a.constraintReady) || b.searchRank - a.searchRank);
  const output = [];
  const perBucket = new Map();
  const seen = new Set();

  function tryKeep(state, { enforceBucket = true } = {}) {
    if (output.length >= limit) return false;
    const key = [...state.ids].sort().join('|');
    if (seen.has(key)) return false;
    const bucket = stateBucket(state, context);
    const used = perBucket.get(bucket) || 0;
    if (enforceBucket && used >= context.profile.search.stateBucketLimit) return false;
    seen.add(key);
    perBucket.set(bucket, used + 1);
    output.push(state);
    return true;
  }

  // A generated Dofus combination can be temporarily hidden by several strong
  // children from another lineage after the next equipment slot expands. Keep
  // a bounded offensive lane for the most promising generated lineages, using
  // the Dofus choice objective captured before cross-slot noise is introduced.
  // The existing offense reserve is the budget: lineages outside that budget
  // receive no absolute protection and compete normally for the remaining beam.
  const lineageReserve = Math.min(
    Math.max(0, limit - output.length),
    Math.max(0, Number(context.profile.search.groupOffenseReserve || 0))
  );
  if (lineageReserve > 0) {
    const bestByLineage = new Map();
    for (const state of states) {
      const lineageKey = dofusLineageKey(state);
      const promise = Number(state.dofusLineageObjectiveScore);
      if (!lineageKey || !Number.isFinite(promise)) continue;
      if (!bestByLineage.has(lineageKey)) bestByLineage.set(lineageKey, state);
    }
    const representatives = [...bestByLineage.values()]
      .sort((a, b) => Number(b.dofusLineageObjectiveScore || 0) - Number(a.dofusLineageObjectiveScore || 0)
        || Number(b.constraintReady) - Number(a.constraintReady)
        || b.searchRank - a.searchRank
        || dofusLineageKey(a).localeCompare(dofusLineageKey(b)))
      .slice(0, lineageReserve);
    for (const state of representatives) tryKeep(state, { enforceBucket: false });
  }

  // Multiplicative specialists can look weak while a build is still partial.
  // Preserve a narrow lane for each context-relevant Pareto dimension so that
  // complete-build evaluation, not a partial scalar rank, gets the final say.
  const specialistReserve = Math.max(0, Number(context.profile.search.groupSpecialistReservePerStat || 0));
  for (const statKey of context.policy.paretoKeys || []) {
    if (output.length >= limit || specialistReserve <= 0) break;
    const bySpecialist = [...states]
      .filter((state) => num(state.searchStats, statKey) > 0)
      .sort((a, b) => num(b.searchStats, statKey) - num(a.searchStats, statKey)
        || Number(b.constraintReady) - Number(a.constraintReady)
        || b.searchRank - a.searchRank);
    let kept = 0;
    for (const state of bySpecialist) {
      if (tryKeep(state, { enforceBucket: false })) kept++;
      if (kept >= specialistReserve || output.length >= limit) break;
    }
  }

  for (const state of states) {
    if (output.length >= limit) break;
    tryKeep(state, { enforceBucket: true });
  }
  return output;
}

function addCount(map, reason) {
  map.set(reason, (map.get(reason) || 0) + 1);
}

function originForEntry(entry) {
  return entry?.architecture ? 'set-core' : 'standalone';
}

export function searchArchitecturesV2({
  items = [],
  sets = [],
  selections = [],
  constraints = {},
  fmPolicy = {},
  turnMode = 'sum',
  scenario = {},
  requiredItemIds = [],
  topN = 10,
  searchProfile = 'BALANCED',
  onProgress = null
} = {}) {
  const trophyEligibility = optimizerTrophyEligibilityCounts(items);
  const eligibleItems = filterOptimizerEligibleItems(items);
  const required = requiredConstraint(eligibleItems, requiredItemIds);
  if (!required.valid) {
    const impossible = impossibleRequiredResult(required);
    impossible.diagnostics.trophyEligibility = trophyEligibility;
    return impossible;
  }

  const profile = getSearchProfile(searchProfile);
  const extraConstraints = positiveConstraintKeys(constraints).some((key) => !['ap', 'mp'].includes(key));
  const prefilter = prefilterItems({
    items: eligibleItems,
    sets,
    selections,
    constraints,
    turnMode,
    scenario,
    requiredItemIds: required.ids,
    searchProfile: profile
  });
  const policy = prefilter.policy;
  const setsById = Object.fromEntries((sets || []).map((set) => [set.id, set]));
  const context = { policy, profile, selections, constraints, fmPolicy, turnMode, scenario, sets, setsById };

  const synergy = buildSetSynergyIndex({
    items: prefilter.items,
    sets,
    selections,
    constraints,
    turnMode,
    scenario,
    maxPlans: extraConstraints ? profile.search.constrainedArchitectureMaxPlans : profile.search.architectureMaxPlans,
    maxArchitectures: profile.search.architectureMaxCount,
    policy,
    searchProfile: profile
  });

  const originalById = new Map(eligibleItems.map((item) => [String(item.id), item]));
  const slotProfiles = new Map();
  for (const rule of SLOT_RULES) {
    const profiles = (prefilter.pools?.[rule.id] || [])
      .map((item) => policy.profileItem(item))
      .sort((a, b) => b.rankScore - a.rankScore || String(a.item.id).localeCompare(String(b.item.id)));
    slotProfiles.set(rule.id, profiles);
  }
  const profilesFor = (slot) => slotProfiles.get(slot) || [];

  const choiceCache = new Map();
  function choicesFor(slot, count) {
    const key = `${slot}:${count}`;
    if (choiceCache.has(key)) return choiceCache.get(key);
    const choices = buildGroupChoices(profilesFor(slot), count, { ...context, slot });
    choiceCache.set(key, choices);
    return choices;
  }

  const queue = [];
  const standalone = { architecture: null, variant: { label: 'standalones', anchorIds: [] } };
  if (extraConstraints) queue.push(standalone);
  for (const architecture of synergy.architectures) {
    for (const variant of mutationVariants(architecture, profile.search.mutationLimit)) queue.push({ architecture, variant });
  }
  if (!extraConstraints) queue.push(standalone);

  const results = [];
  const rejectReasons = new Map();
  const pruneReasons = new Map();
  const evaluatedByOrigin = { 'set-core': 0, standalone: 0 };
  const validByOrigin = { 'set-core': 0, standalone: 0 };
  const bestByOrigin = { 'set-core': null, standalone: null };
  let evaluated = 0;
  let valid = 0;
  let expandedStates = 0;
  let legalCandidates = 0;
  let safePruned = 0;
  let heuristicTrimmed = 0;

  function report(label = '') {
    if (!onProgress) return;
    onProgress({
      nodes: evaluated,
      visited: valid,
      pruned: safePruned + [...rejectReasons.values()].reduce((sum, value) => sum + value, 0),
      heuristicTrimmed,
      best: results[0]?.score || 0,
      threshold: results.length >= topN ? results[results.length - 1].score : null,
      partialResults: results.length ? [...results] : null,
      seeded: true,
      phase: 'architectures-v2',
      label: required.ids.length ? `${label} · ${required.ids.length} imposé${required.ids.length > 1 ? 's' : ''}` : label,
      rejected: Object.fromEntries(rejectReasons),
      pruneReasons: Object.fromEntries(pruneReasons),
      setCores: synergy.diagnostics
    });
  }

  for (const entry of queue) {
    const searchOrigin = originForEntry(entry);
    const optionalAnchors = entry.variant.anchorIds.map((id) => originalById.get(String(id))).filter(Boolean);
    const anchors = mergeRequiredAnchors(required.requiredItems, optionalAnchors);
    const counts = slotCounts(anchors);
    if (SLOT_RULES.some((rule) => (counts.get(rule.id) || 0) > Number(rule.count || 0))) continue;

    const missing = SLOT_RULES
      .map((rule) => ({ ...rule, missing: Number(rule.count || 0) - (counts.get(rule.id) || 0) }))
      .filter((group) => group.missing > 0)
      .sort((a, b) => {
        if (a.id === 'dofus' && b.id !== 'dofus') return -1;
        if (b.id === 'dofus' && a.id !== 'dofus') return 1;
        return choicesFor(a.id, a.missing).length - choicesFor(b.id, b.missing).length;
      });

    const initialFeasibility = branchFeasibility({
      items: anchors,
      remainingGroups: missing,
      profilesFor,
      constraints,
      fmPolicy,
      sets,
      setsById
    });
    if (!initialFeasibility.feasible) {
      const reason = initialFeasibility.key === 'shape'
        ? 'impossible build shape'
        : `impossible ${initialFeasibility.key} constraint`;
      addCount(pruneReasons, reason);
      safePruned++;
      continue;
    }

    let states = [{
      items: anchors,
      ids: new Set(anchors.map((item) => String(item.id))),
      heuristic: Number(entry.architecture?.score || 0)
    }];

    for (let groupIndex = 0; groupIndex < missing.length; groupIndex++) {
      const group = missing[groupIndex];
      const choices = choicesFor(group.id, group.missing);
      const remainingGroups = missing.slice(groupIndex + 1);
      const next = [];
      for (const state of states) {
        for (const choice of choices) {
          if (choice.items.some((item) => state.ids.has(String(item.id)))) continue;
          const nextItems = [...state.items, ...choice.items];
          if (!specialSlotRulesAreValid(nextItems)) continue;

          const feasibility = branchFeasibility({
            items: nextItems,
            remainingGroups,
            profilesFor,
            constraints,
            fmPolicy,
            sets,
            setsById
          });
          if (!feasibility.feasible) {
            const reason = feasibility.key === 'shape'
              ? 'impossible build shape'
              : `impossible ${feasibility.key} constraint`;
            addCount(pruneReasons, reason);
            safePruned++;
            continue;
          }

          const threshold = results.length >= Math.max(1, Number(topN || 10))
            ? Number(results[results.length - 1].score || 0)
            : null;
          if (threshold !== null) {
            const bound = offensiveUpperBound({
              items: nextItems,
              remainingGroups,
              profilesFor,
              policy,
              sets,
              fmPolicy
            });
            if (Number.isFinite(bound) && bound + 1e-9 < threshold) {
              addCount(pruneReasons, 'offensive upper bound below current threshold');
              safePruned++;
              continue;
            }
          }

          next.push({
            items: nextItems,
            ids: new Set([...state.ids, ...choice.items.map((item) => String(item.id))]),
            heuristic: state.heuristic + choice.score,
            dofusLineageObjectiveScore: group.id === 'dofus'
              ? Number(choice.objectiveScore || 0)
              : state.dofusLineageObjectiveScore
          });
          expandedStates++;
        }
      }

      const stateLimit = group.id === 'dofus'
        ? profile.search.dofusStateBeamWidth
        : profile.search.stateBeamWidth;
      const kept = keepDiverseStates(next, context, stateLimit);
      heuristicTrimmed += Math.max(0, next.length - kept.length);
      states = kept;
      if (!states.length) break;
    }

    const complete = states.filter((state) => fullShape(state.items));
    complete.sort((a, b) => {
      const pa = constraintProgressForStats(progressStats(a.items, setsById, constraints, fmPolicy), constraints);
      const pb = constraintProgressForStats(progressStats(b.items, setsById, constraints, fmPolicy), constraints);
      return Number(pb.ready) - Number(pa.ready)
        || (b.searchRank || b.heuristic) - (a.searchRank || a.heuristic);
    });

    legalCandidates += complete.length;
    const evaluationLimit = extraConstraints
      ? profile.search.constrainedEvaluationLimit
      : profile.search.evaluationLimit;
    const evaluationPool = complete.slice(0, evaluationLimit);
    heuristicTrimmed += Math.max(0, complete.length - evaluationPool.length);

    for (const state of evaluationPool) {
      const evaluation = evaluateCompleteBuild({
        items: state.items,
        sets,
        selections,
        constraints,
        fmPolicy: { ...fmPolicy, structuralExos: false },
        turnMode,
        scenario
      });
      evaluated++;
      evaluatedByOrigin[searchOrigin]++;
      if (evaluation.result) {
        valid++;
        validByOrigin[searchOrigin]++;
        bestByOrigin[searchOrigin] = bestByOrigin[searchOrigin] === null
          ? Number(evaluation.result.score || 0)
          : Math.max(bestByOrigin[searchOrigin], Number(evaluation.result.score || 0));
        const decorated = {
          ...evaluation.result,
          searchOrigin,
          searchArchitecture: entry.variant.label,
          searchWhySelected: [...(entry.architecture?.whySelected || [])]
        };
        insertTop(results, decorated, Math.max(1, Number(topN || 10)));
      } else {
        addCount(rejectReasons, evaluation.reason || 'unknown');
      }
      if (evaluated % 12 === 0 || evaluation.result) report(entry.variant.label);
    }
    report(entry.variant.label);
  }

  const searchProfileName = typeof searchProfile === 'string' ? String(searchProfile).toUpperCase() : 'CUSTOM';
  return {
    results,
    candidateItems: prefilter.items,
    candidatePools: prefilter.pools,
    diagnostics: {
      mode: 'architecture-search-v2',
      searchModes: ['set-core', 'standalone'],
      searchProfile: searchProfileName,
      profile: synergy.profile,
      targetElement: synergy.targetElement,
      architectures: synergy.architectures.length,
      architectureVariants: queue.length,
      setCores: synergy.diagnostics,
      requiredItemIds: required.ids,
      extraConstraintSearch: extraConstraints,
      constrainedStats: positiveConstraintKeys(constraints),
      evaluated,
      valid,
      evaluatedByOrigin,
      validByOrigin,
      bestByOrigin,
      legalCandidates,
      expandedStates,
      safePruned,
      heuristicTrimmed,
      pruneReasons: Object.fromEntries(pruneReasons),
      rejected: Object.fromEntries(rejectReasons),
      prefilter: prefilter.diagnostics,
      trophyEligibility,
      nodes: evaluated,
      visited: valid,
      pruned: safePruned + [...rejectReasons.values()].reduce((sum, value) => sum + value, 0)
    }
  };
}
