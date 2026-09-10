import { BASE_CHARACTER, SLOT_RULES } from './config.js';
import { addStats, effectiveStat, emptyStats } from './stats.js';
import { applySetBonuses } from './sets.js';
import {
  MAX_PERMANENT_AP,
  MAX_PERMANENT_MP,
  specialSlotRulesAreValid
} from './build-legality.js';
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
import { pruneDominatedCandidates } from './search-space.js';

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

function diagnosticStaticValue(stats = {}, key, fmPolicy = {}) {
  const base = Number(BASE_CHARACTER.baseStats?.[key] || 0);
  const exo = key === 'ap' ? (Number(fmPolicy?.exoAp) === 1 ? 1 : 0)
    : key === 'mp' ? (Number(fmPolicy?.exoMp) === 1 ? 1 : 0) : 0;
  return base + exo + Number(effectiveStat(stats, key) || 0);
}

function diagnosticDistribution(states = [], key, fmPolicy = {}) {
  const counts = new Map();
  for (const state of states) {
    const value = diagnosticStaticValue(state?.stats || {}, key, fmPolicy);
    counts.set(value, Number(counts.get(value) || 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort((a, b) => Number(a[0]) - Number(b[0])));
}

function printDiagnosticLossStats(witnessState, retainedStates, fmPolicy = {}) {
  if (!witnessState) return;
  const witnessAp = diagnosticStaticValue(witnessState.stats, 'ap', fmPolicy);
  const witnessMp = diagnosticStaticValue(witnessState.stats, 'mp', fmPolicy);
  const apCounts = diagnosticDistribution(retainedStates, 'ap', fmPolicy);
  const mpCounts = diagnosticDistribution(retainedStates, 'mp', fmPolicy);
  const overAp = retainedStates.filter((state) => diagnosticStaticValue(state.stats, 'ap', fmPolicy) > MAX_PERMANENT_AP).length;
  const overMp = retainedStates.filter((state) => diagnosticStaticValue(state.stats, 'mp', fmPolicy) > MAX_PERMANENT_MP).length;
  console.log(`TRACE_WITNESS_STATIC_AP=${witnessAp}`);
  console.log(`TRACE_WITNESS_STATIC_MP=${witnessMp}`);
  console.log(`TRACE_RETAINED_AP_COUNTS=${JSON.stringify(apCounts)}`);
  console.log(`TRACE_RETAINED_MP_COUNTS=${JSON.stringify(mpCounts)}`);
  console.log(`TRACE_RETAINED_OVER_AP_CAP=${overAp}`);
  console.log(`TRACE_RETAINED_OVER_MP_CAP=${overMp}`);
}

function recordDiagnosticFirstLoss(diagnostic, point, evidence, extra = {}) {
  if (!diagnostic || diagnostic.firstLoss) return false;
  diagnostic.firstLoss = { point, evidence, ...extra };
  console.log(`FIRST_LOSS_POINT=${point}`);
  console.log(`FIRST_LOSS_EVIDENCE=${evidence}`);
  for (const [key, value] of Object.entries(extra)) console.log(`${key}=${value}`);
  return true;
}

function buildGroupChoices(profiles = [], count = 1, context = {}) {
  if (count <= 0) return [{ items: [], stats: {}, rankScore: 0 }];
  let states = [{ items: [], ids: new Set(), stats: {}, rankScore: 0 }];
  const finalLimit = Math.max(
    1,
    Number(context.profile.search.groupChoiceLimits?.[context.slot] || 1)
  );
  const intermediateBeamWidth = context.slot === 'dofus'
    ? context.profile.search.dofusGroupBeamWidth
    : count >= 5 ? context.profile.search.multiPickBeamWidth : context.profile.search.groupBeamWidth;
  const intermediateLimit = Math.max(
    finalLimit,
    Number(intermediateBeamWidth || 1)
  );
  const diagnostic = context.diagnostic || null;
  const witnessChoiceIds = new Set((context.diagnosticWitnessChoiceIds || []).map(String));
  let finalPickSnapshot = null;

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
    const dedupStates = [...dedup.values()];
    const pickLimit = pick === count - 1 ? finalLimit : intermediateLimit;
    const diverseStates = count === 1
      ? [...dedupStates].sort((a, b) => b.rankScore - a.rankScore || itemKey(a.items).localeCompare(itemKey(b.items)))
      : keepEquipmentDiversity(dedupStates, pickLimit, {
          policy: context.policy,
          constraints: context.constraints,
          bucketLimit: context.profile.search.groupBucketLimit
        });

    if (diagnostic && !diagnostic.firstLoss && witnessChoiceIds.size) {
      const compatible = (state) => state.items.length === pick + 1
        && state.items.every((item) => witnessChoiceIds.has(String(item.id)));
      const witnessRaw = next.some(compatible);
      const witnessDedup = dedupStates.some(compatible);
      const witnessDiverse = diverseStates.some(compatible);
      if (witnessRaw && witnessDedup && !witnessDiverse) {
        const witnessState = dedupStates.find(compatible);
        const ranked = [...dedupStates].sort((a, b) => b.rankScore - a.rankScore || itemKey(a.items).localeCompare(itemKey(b.items)));
        const rank = witnessState ? ranked.findIndex((state) => itemKey(state.items) === itemKey(witnessState.items)) + 1 : 0;
        const bucket = witnessState ? stateBucket(witnessState, context.constraints) : 'NA';
        const signature = witnessState ? setSignature(witnessState.items) : 'NA';
        if (recordDiagnosticFirstLoss(
          diagnostic,
          'GROUP_CHOICE_DIVERSITY',
          `slot=${context.slot}|pick=${pick + 1}|witness-compatible partial removed by keepEquipmentDiversity`,
          {
            FIRST_LOSS_OPERATION: 'KEEP_EQUIPMENT_DIVERSITY',
            FIRST_LOSS_RANK: rank || 'NA',
            FIRST_LOSS_LIMIT: pickLimit,
            FIRST_LOSS_BUCKET: bucket,
            FIRST_LOSS_SET_SIGNATURE: signature || 'EMPTY'
          }
        )) printDiagnosticLossStats(witnessState, diverseStates, context.fmPolicy);
      }
    }

    states = diverseStates;
    if (pick === count - 1) {
      finalPickSnapshot = {
        raw: next,
        dedup: dedupStates,
        diverse: diverseStates
      };
    }
    if (!states.length) break;
  }

  const finalStates = states;

  if (diagnostic && witnessChoiceIds.size) {
    const witnessKey = [...witnessChoiceIds].sort().join('|');
    const exact = (state) => itemKey(state.items) === witnessKey;
    const rawStates = finalPickSnapshot?.raw || [];
    const dedupStates = finalPickSnapshot?.dedup || [];
    const diverseStates = finalPickSnapshot?.diverse || [];
    const witnessRaw = rawStates.some(exact);
    const witnessDedup = dedupStates.some(exact);
    const witnessDiverse = diverseStates.some(exact);
    const witnessFinal = finalStates.some(exact);
    const rankedRaw = [...dedupStates]
      .sort((a, b) => b.rankScore - a.rankScore || itemKey(a.items).localeCompare(itemKey(b.items)));
    const rank = witnessDedup ? rankedRaw.findIndex(exact) + 1 : 0;
    console.log(`TRACE_GROUP=|pool=${context.slot}|pick=${count}|raw=${rawStates.length}|dedup=${dedupStates.length}|diverse=${diverseStates.length}|final=${finalStates.length}|limit=${finalLimit}|witnessRaw=${witnessRaw ? 'YES' : 'NO'}|witnessDedup=${witnessDedup ? 'YES' : 'NO'}|witnessDiverse=${witnessDiverse ? 'YES' : 'NO'}|witnessPreSlice=${witnessDiverse ? 'YES' : 'NO'}|witnessFinal=${witnessFinal ? 'YES' : 'NO'}|preSliceRank=${rank || 'NA'}`);

    if (!diagnostic.firstLoss && !witnessRaw) {
      recordDiagnosticFirstLoss(
        diagnostic,
        'GROUP_CHOICE_EXPANSION',
        `slot=${context.slot}|exact witness group choice never reached final raw expansion`,
        { FIRST_LOSS_OPERATION: 'RAW_EXPANSION' }
      );
    }
  }

  return finalStates;
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
      authoritativeEvaluated: 0,
      finalEvaluationTrimmed: 0,
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
  diagnosticWitnessItemIds = [],
  topN = 10,
  searchProfile = 'BALANCED',
  onProgress = null,
  onDiagnostics = null
} = {}) {
  const diagnosticIds = [...new Set((diagnosticWitnessItemIds || []).map(String).filter(Boolean))];
  const diagnostic = diagnosticIds.length ? { ids: diagnosticIds, firstLoss: null } : null;
  const rawById = new Map((items || []).map((item) => [String(item.id), item]));
  const trophyEligibility = optimizerTrophyEligibilityCounts(items);
  const eligibleItems = filterOptimizerEligibleItems(items);
  const eligibleById = new Map(eligibleItems.map((item) => [String(item.id), item]));

  if (diagnostic) {
    const rawCount = diagnosticIds.filter((id) => rawById.has(id)).length;
    const eligibleCount = diagnosticIds.filter((id) => eligibleById.has(id)).length;
    console.log(`TRACE_RAW_WITNESS_COUNT=${rawCount}`);
    console.log(`TRACE_ELIGIBLE_WITNESS_COUNT=${eligibleCount}`);
    for (const id of diagnosticIds) {
      const item = rawById.get(id) || eligibleById.get(id);
      console.log(`TRACE_ITEM=${id}|slot=${item?.slot || 'NA'}|raw=${rawById.has(id) ? 'YES' : 'NO'}|eligible=${eligibleById.has(id) ? 'YES' : 'NO'}`);
    }
    if (rawCount !== diagnosticIds.length || eligibleCount !== diagnosticIds.length) {
      recordDiagnosticFirstLoss(
        diagnostic,
        'RAW_ELIGIBILITY',
        `raw=${rawCount}/${diagnosticIds.length}|eligible=${eligibleCount}/${diagnosticIds.length}`
      );
    }
  }

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

  if (diagnostic && !diagnostic.firstLoss) {
    let poolWitnessCount = 0;
    let firstMissing = null;
    for (const id of diagnosticIds) {
      const item = eligibleById.get(id);
      const pool = item ? (prefilter.pools?.[item.slot] || []) : [];
      const position = item ? pool.findIndex((entry) => String(entry.id) === id) : -1;
      const present = position >= 0;
      if (present) poolWitnessCount++;
      const slotDiag = prefilter.diagnostics?.slots?.find((entry) => entry.id === item?.slot);
      const reasons = slotDiag?.reasons?.[id] || [];
      console.log(`TRACE_POOL_ITEM=${id}|slot=${item?.slot || 'NA'}|present=${present ? 'YES' : 'NO'}|position=${present ? `${position + 1}/${pool.length}` : 'NA'}|reasons=${reasons.join(',') || 'NONE'}`);
      if (!present && !firstMissing && item) firstMissing = item;
    }
    console.log(`TRACE_POOL_WITNESS_COUNT=${poolWitnessCount}`);

    if (firstMissing) {
      const rule = SLOT_RULES.find((entry) => entry.id === firstMissing.slot);
      const slotItems = eligibleItems.filter((item) => item?.slot === firstMissing.slot);
      const pareto = pruneDominatedCandidates(slotItems, {
        keys: policy.paretoKeys,
        nonMonotoneKeys: policy.nonMonotoneKeys,
        groupCount: Number(rule?.count || 1)
      });
      const paretoSurvived = pareto.candidates.some((item) => String(item.id) === String(firstMissing.id));
      console.log(`TRACE_POOL_MISSING=${firstMissing.id}|slot=${firstMissing.slot}|paretoSurvived=${paretoSurvived ? 'YES' : 'NO'}`);
      recordDiagnosticFirstLoss(
        diagnostic,
        paretoSurvived ? 'CANDIDATE_POOL_SHORTLIST' : 'CANDIDATE_POOL_PARETO',
        `item=${firstMissing.id}|slot=${firstMissing.slot}|paretoSurvived=${paretoSurvived ? 'YES' : 'NO'}`,
        {
          FIRST_POOL_MISSING_ITEM: firstMissing.id,
          FIRST_POOL_MISSING_PARETO_SURVIVED: paretoSurvived ? 'YES' : 'NO'
        }
      );
    }
  }

  const requiredIds = new Set(required.ids);
  const requiredCounts = slotCounts(required.requiredItems);
  const witnessBySlot = diagnostic
    ? Object.fromEntries(SLOT_RULES.map((rule) => [rule.id, diagnosticIds.filter((id) => eligibleById.get(id)?.slot === rule.id)]))
    : {};
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
      fmPolicy,
      setsById,
      diagnostic: diagnostic && !diagnostic.firstLoss ? diagnostic : null,
      diagnosticWitnessChoiceIds: diagnostic && !diagnostic.firstLoss ? (witnessBySlot[rule.id] || []) : []
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

  if (diagnostic && !diagnostic.firstLoss) console.log(`TRACE_GROUP_ORDER=${groups.map((group) => group.id).join('|')}`);

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
  const processedWitnessIds = new Set(required.ids.filter((id) => diagnosticIds.includes(id)));

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

    if (diagnostic && !diagnostic.firstLoss) {
      for (const id of witnessBySlot[group.id] || []) processedWitnessIds.add(id);
      const prefixKey = [...processedWitnessIds].sort().join('|');
      const matchesPrefix = (state) => itemKey(state.items) === prefixKey;
      const witnessBefore = next.find(matchesPrefix);
      const witnessAfter = kept.find(matchesPrefix);
      const rankedNext = [...next].sort((a, b) => b.rankScore - a.rankScore || itemKey(a.items).localeCompare(itemKey(b.items)));
      const rank = witnessBefore ? rankedNext.findIndex(matchesPrefix) + 1 : 0;
      const bucket = witnessBefore ? stateBucket(witnessBefore, constraints) : 'NA';
      const signature = witnessBefore ? setSignature(witnessBefore.items) : 'NA';
      console.log(`TRACE_STATE=|group=${group.id}|incoming=${states.length}|choices=${choices.length}|expanded=${next.length}|beam=${kept.length}|bucketLimit=${profile.search.stateBucketLimit}|witnessBefore=${witnessBefore ? 'YES' : 'NO'}|witnessAfter=${witnessAfter ? 'YES' : 'NO'}|rank=${rank || 'NA'}|rankScore=${witnessBefore?.rankScore ?? 'NA'}|bucket=${bucket}|setSignature=${signature || 'EMPTY'}`);
      if (witnessBefore && !witnessAfter) {
        if (recordDiagnosticFirstLoss(
          diagnostic,
          'STATE_BEAM',
          `group=${group.id}|exact witness prefix present before keepEquipmentDiversity and absent after beam`,
          {
            FIRST_LOSS_BEAM_LIMIT: stateLimit,
            FIRST_LOSS_WITNESS_RANK: rank || 'NA',
            FIRST_LOSS_WITNESS_BUCKET: bucket,
            FIRST_LOSS_WITNESS_SET_SIGNATURE: signature || 'EMPTY'
          }
        )) printDiagnosticLossStats(witnessBefore, kept, fmPolicy);
      } else if (!witnessBefore) {
        recordDiagnosticFirstLoss(
          diagnostic,
          'STATE_EXPANSION',
          `group=${group.id}|exact witness prefix absent before state beam`,
          { FIRST_LOSS_BEAM_LIMIT: stateLimit }
        );
      }
    }

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
  const evaluationPool = complete;
  const finalEvaluationTrimmed = 0;
  trace.push({ stage: 'complete-evaluation-pool', count: evaluationPool.length, trimmed: finalEvaluationTrimmed });

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
      authoritativeEvaluated: evaluated,
      finalEvaluationTrimmed,
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
