import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { BASE_CHARACTER, SLOT_RULES } from '../js/config.js';
import { validateDofusSnapshot } from '../js/data-loader.js';
import { searchEquipmentArchitecturesV2 } from '../js/equipment-search-v2.js';
import {
  completeSlotStructureIsValid,
  countSetBonuses,
  itemConditionsAreValid,
  permanentStatCapViolations,
  specialSlotRulesAreValid
} from '../js/build-legality.js';
import {
  compareCompleteEquipmentBuildResults,
  evaluateCompleteEquipmentBuild
} from '../js/complete-equipment-build-evaluator.js';
import { addStats, constraintDeficits, effectiveStat, emptyStats } from '../js/stats.js';
import { applySetBonuses } from '../js/sets.js';
import { pruneDominatedCandidates } from '../js/search-space.js';
import {
  buildEquipmentCandidatePools,
  positiveEquipmentConstraintKeys
} from '../optimizer/equipment-candidate-policy.js';
import { filterOptimizerEligibleItems } from '../optimizer/item-eligibility.js';
import { getSearchProfile } from '../optimizer/search-profiles.js';

const WITNESS_IDS = Object.freeze([
  'item-22191',
  'item-14162',
  'item-15696',
  'item-26011',
  'item-14169',
  'item-22189',
  'item-13641',
  'item-22192',
  'item-13642',
  'item-13465',
  'item-22001',
  'item-13762',
  'item-13828',
  'item-694',
  'item-7754',
  'item-8698'
]);

const raw = JSON.parse(readFileSync(new URL('../data/normalized/dofus-data.json', import.meta.url), 'utf8'));
const dataset = validateDofusSnapshot(raw);
const syntheticOffense = { elements: ['earth'], profiles: ['large'] };
const constraints = { ap: 12, mp: 6 };
const fmPolicy = { exoAp: 0, exoMp: 0 };
const topN = 3;

const byId = new Map(dataset.items.map((item) => [String(item.id), item]));
const witnessItems = WITNESS_IDS.map((id) => byId.get(id)).filter(Boolean);
if (witnessItems.length !== WITNESS_IDS.length) {
  const missing = WITNESS_IDS.filter((id) => !byId.has(id));
  throw new Error(`Authoritative witness dataset drift: resolved ${witnessItems.length}/${WITNESS_IDS.length}; missing=${missing.join('|')}`);
}

const direct = evaluateCompleteEquipmentBuild({
  items: witnessItems,
  sets: dataset.sets,
  constraints,
  fmPolicy,
  syntheticOffense
});
const directValid = Boolean(direct.result);
console.log(`TRACE_DIRECT_WITNESS_VALID=${directValid ? 'YES' : 'NO'}`);
console.log(`TRACE_DIRECT_WITNESS_AP=${direct.result?.stats?.ap ?? 'NA'}`);
console.log(`TRACE_DIRECT_WITNESS_MP=${direct.result?.stats?.mp ?? 'NA'}`);
console.log(`TRACE_DIRECT_WITNESS_MIN=${direct.result?.syntheticOffense?.minimumScore ?? 'NA'}`);
console.log(`TRACE_DIRECT_WITNESS_MEAN=${direct.result?.syntheticOffense?.meanScore ?? 'NA'}`);
console.log(`TRACE_DIRECT_WITNESS_IDENTITY=${direct.result?.items?.map((item) => String(item.id)).sort().join('|') || 'NA'}`);
if (!directValid) throw new Error(`Authoritative witness failed direct evaluator: ${direct.reason || 'unknown'}`);

const forced = searchEquipmentArchitecturesV2({
  items: dataset.items,
  sets: dataset.sets,
  constraints,
  fmPolicy,
  syntheticOffense,
  requiredItemIds: WITNESS_IDS,
  topN,
  searchProfile: 'BALANCED'
});
const forcedIdentity = forced.results[0]?.items?.map((item) => String(item.id)).sort().join('|') || 'NA';
const expectedIdentity = [...WITNESS_IDS].sort().join('|');
const forcedValid = forced.results.length > 0 && forcedIdentity === expectedIdentity;
console.log(`TRACE_FORCED_WITNESS_VALID=${forcedValid ? 'YES' : 'NO'}`);
console.log(`TRACE_FORCED_WITNESS_RESULT_COUNT=${forced.results.length}`);
console.log(`TRACE_FORCED_WITNESS_IDENTITY=${forcedIdentity}`);
console.log(`TRACE_FORCED_WITNESS_MIN=${forced.results[0]?.syntheticOffense?.minimumScore ?? 'NA'}`);
if (!forcedValid) {
  console.log('FIRST_LOSS_POINT=FORCED_PATH_INCONSISTENCY');
  console.log(`FIRST_LOSS_EVIDENCE=direct evaluator passed but requiredItemIds search returned ${forced.results.length} result(s); reason=${forced.diagnostics?.reason || 'none'}`);
}

function itemKey(items = []) {
  return items.map((item) => String(item?.id ?? '')).sort().join('|');
}

function setsByIdFor(sets = []) {
  return Object.fromEntries((sets || []).map((set) => [String(set.id), set]));
}

function staticStats(items = [], setsById = {}) {
  const stats = emptyStats();
  for (const item of items || []) addStats(stats, item?.stats || {});
  applySetBonuses(stats, items, setsById);
  return stats;
}

function fullStaticStats(items = [], setsById = {}) {
  const stats = emptyStats();
  addStats(stats, BASE_CHARACTER.baseStats || {});
  for (const item of items || []) addStats(stats, item?.stats || {});
  applySetBonuses(stats, items, setsById);
  return stats;
}

function constraintProgress(stats = {}, minimums = {}) {
  let coverage = 0;
  const signature = [];
  for (const key of positiveEquipmentConstraintKeys(minimums)) {
    const target = Math.max(1, Number(minimums[key] || 0));
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

function stateBucket(state, minimums = {}) {
  const progress = constraintProgress(state.stats, minimums);
  return `${Math.min(12, effectiveStat(state.stats, 'ap'))}:${Math.min(6, effectiveStat(state.stats, 'mp'))}:${progress.signature}:${setSignature(state.items)}`;
}

function keepEquipmentDiversity(states, limit, { policy, minimums, bucketLimit = 10 } = {}) {
  if (states.length <= limit) return states;
  const ranked = [...states].sort((a, b) => b.rankScore - a.rankScore || itemKey(a.items).localeCompare(itemKey(b.items)));
  const output = [];
  const seen = new Set();
  const perBucket = new Map();

  function keep(state, enforceBucket = true) {
    if (!state || output.length >= limit) return false;
    const key = itemKey(state.items);
    if (seen.has(key)) return false;
    const bucket = stateBucket(state, minimums);
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

function conditionStatKeys(node, output = new Set()) {
  if (!node) return output;
  if (node.kind === 'relation') {
    for (const child of node.children || []) conditionStatKeys(child, output);
  } else if (node.stat) output.add(String(node.stat));
  return output;
}

function ringPairDiagnostic() {
  const eligibleItems = filterOptimizerEligibleItems(dataset.items);
  const profile = getSearchProfile('BALANCED');
  const prefilter = buildEquipmentCandidatePools({
    items: eligibleItems,
    sets: dataset.sets,
    constraints,
    fmPolicy,
    syntheticOffense,
    searchProfile: profile
  });
  const policy = prefilter.policy;
  const setsById = setsByIdFor(dataset.sets);
  const ringRule = SLOT_RULES.find((rule) => rule.id === 'ring');
  const ringEligible = eligibleItems.filter((item) => item.slot === 'ring');
  const ringPool = prefilter.pools.ring || [];
  const ringDiag = prefilter.diagnostics.slots.find((entry) => entry.id === 'ring');
  const ringProfiles = ringPool.map((item) => policy.profileItem(item));
  const profileById = new Map(ringProfiles.map((entry) => [String(entry.item.id), entry]));
  const reasonMap = ringDiag?.reasons || {};
  const witnessRings = witnessItems.filter((item) => item.slot === 'ring');
  if (witnessRings.length !== 2) throw new Error(`Expected two witness rings, got ${witnessRings.length}`);
  const [ringA, ringB] = witnessRings;

  console.log('RING_DIAGNOSTIC_BEGIN=YES');
  console.log(`RING_RAW_ELIGIBLE_COUNT=${ringEligible.length}`);
  console.log(`RING_PARETO_KEPT=${ringDiag?.paretoKept ?? 'NA'}`);
  console.log(`RING_TARGET=${ringDiag?.target ?? 'NA'}`);
  console.log(`RING_AFTER_SHORTLIST=${ringPool.length}`);
  for (const reason of ['pareto', 'set-core', 'rank-fill']) {
    const count = ringPool.filter((item) => (reasonMap[String(item.id)] || []).includes(reason)).length;
    console.log(`RING_${reason.replace('-', '_').toUpperCase()}_SELECTED_UNIQUE_COUNT=${count}`);
  }
  const specialistCount = ringPool.filter((item) => (reasonMap[String(item.id)] || []).some((reason) => reason.startsWith('specialist:'))).length;
  console.log(`RING_SPECIALIST_SELECTED_UNIQUE_COUNT=${specialistCount}`);

  const pareto = pruneDominatedCandidates(ringEligible, {
    keys: policy.paretoKeys,
    nonMonotoneKeys: policy.nonMonotoneKeys,
    groupCount: Number(ringRule?.count || 1)
  });
  const paretoIds = new Set(pareto.candidates.map((item) => String(item.id)));

  for (const [label, ring] of [['A', ringA], ['B', ringB]]) {
    const id = String(ring.id);
    const set = ring.setId ? setsById[String(ring.setId)] : null;
    const position = ringPool.findIndex((item) => String(item.id) === id);
    const p = profileById.get(id);
    console.log(`RING_${label}_ID=${id}`);
    console.log(`RING_${label}_NAME=${ring.name}`);
    console.log(`RING_${label}_SET=${ring.setId ? `${ring.setId}|${set?.name || 'UNKNOWN'}` : 'NONE'}`);
    console.log(`RING_${label}_STATS=${JSON.stringify(ring.stats || {})}`);
    console.log(`RING_${label}_CONDITIONS=${JSON.stringify(ring.conditions ?? null)}`);
    console.log(`RING_${label}_LEVEL=${ring.level ?? 'NA'}`);
    console.log(`RING_${label}_POOL_POSITION=${position >= 0 ? position + 1 : 'NA'}`);
    console.log(`RING_${label}_RANK_SCORE=${p?.rankScore ?? 'NA'}`);
    console.log(`RING_${label}_SELECTION_REASONS=${(reasonMap[id] || []).join(',') || 'NONE'}`);
    console.log(`RING_${label}_PARETO_SURVIVES=${paretoIds.has(id) ? 'YES' : 'NO'}`);
    console.log(`RING_${label}_PARETO_VECTOR=${JSON.stringify(Object.fromEntries(policy.paretoKeys.map((key) => [key, effectiveStat(ring.stats || {}, key)])))}`);
  }

  const rawPairs = [];
  for (let i = 0; i < ringProfiles.length; i++) {
    for (let j = i + 1; j < ringProfiles.length; j++) {
      const items = [ringProfiles[i].item, ringProfiles[j].item];
      if (!specialSlotRulesAreValid(items)) continue;
      const stats = staticStats(items, setsById);
      const ranked = policy.rankStats(stats);
      rawPairs.push({ items, stats, rankScore: ranked.rankScore, syntheticOffense: ranked.syntheticOffense });
    }
  }
  rawPairs.sort((a, b) => b.rankScore - a.rankScore || itemKey(a.items).localeCompare(itemKey(b.items)));
  const rawRankByKey = new Map(rawPairs.map((state, index) => [itemKey(state.items), index + 1]));
  const witnessPairKey = itemKey(witnessRings);
  const witnessPair = rawPairs.find((state) => itemKey(state.items) === witnessPairKey);
  if (!witnessPair) throw new Error('Witness pair missing from raw ring pairs');
  const retained = keepEquipmentDiversity(rawPairs, Number(profile.search.groupChoiceLimits.ring), {
    policy,
    minimums: constraints,
    bucketLimit: profile.search.groupBucketLimit
  });
  const combined = witnessPair.stats;
  const pairProgress = constraintProgress(combined, constraints);
  console.log(`WITNESS_PAIR_RAW_PRESENT=YES`);
  console.log(`WITNESS_PAIR_RAW_RANK=${rawRankByKey.get(witnessPairKey)}`);
  console.log(`WITNESS_PAIR_RANK_SCORE=${witnessPair.rankScore}`);
  console.log(`WITNESS_PAIR_BUCKET=${stateBucket(witnessPair, constraints)}`);
  console.log(`WITNESS_PAIR_SET_SIGNATURE=${setSignature(witnessRings) || 'EMPTY'}`);
  console.log(`WITNESS_PAIR_COMBINED_STATS=${JSON.stringify(combined)}`);
  console.log(`WITNESS_PAIR_SET_IDS=${witnessRings.map((item) => item.setId || 'NONE').join('|')}`);
  console.log(`WITNESS_PAIR_SPECIAL_SLOT_LEGAL=${specialSlotRulesAreValid(witnessRings) ? 'YES' : 'NO'}`);

  const latent = witnessRings.map((ring) => {
    if (!ring.setId) return { id: String(ring.id), relevant: false };
    const set = setsById[String(ring.setId)];
    const same = witnessItems.filter((item) => String(item.setId || '') === String(ring.setId));
    const count = same.length;
    const bonus = set?.bonuses?.[String(count)] || null;
    const withoutBonus = set?.bonuses?.[String(count - 1)] || null;
    const necessary = Boolean(bonus) && JSON.stringify(bonus) !== JSON.stringify(withoutBonus);
    return { id: String(ring.id), setId: String(ring.setId), setName: set?.name || 'UNKNOWN', witnessMemberIds: same.map((item) => String(item.id)), witnessMemberNames: same.map((item) => item.name), count, bonus, withoutBonus, necessary };
  });
  console.log(`TRACE_WITNESS_RING_SET_LINEAGE=${JSON.stringify(latent)}`);
  const latentRelevant = latent.some((entry) => entry.relevant !== false && entry.necessary);
  console.log(`LATENT_SET_LINEAGE_RELEVANT=${latentRelevant ? 'YES' : 'NO'}`);

  const reasonsA = reasonMap[String(ringA.id)] || [];
  const reasonsB = reasonMap[String(ringB.id)] || [];
  const provenanceKinds = (reasons) => new Set(reasons.map((reason) => reason.startsWith('specialist:') ? reason : reason));
  const pa = provenanceKinds(reasonsA);
  const pb = provenanceKinds(reasonsB);
  const distinctProvenance = [...pa].some((reason) => !pb.has(reason)) || [...pb].some((reason) => !pa.has(reason));
  console.log(`RING_A_PRIMARY_PROVENANCE=${reasonsA[0] || 'NONE'}`);
  console.log(`RING_B_PRIMARY_PROVENANCE=${reasonsB[0] || 'NONE'}`);
  console.log(`PAIR_CROSSES_DISTINCT_PROVENANCE=${distinctProvenance ? 'YES' : 'NO'}`);
  console.log('PAIR_PROVENANCE_CURRENTLY_ENCODED_IN_GROUP_DIVERSITY=NO');

  const keysA = conditionStatKeys(ringA.conditions);
  const keysB = conditionStatKeys(ringB.conditions);
  const bHelpsA = [...keysA].some((key) => key === 'setBonus'
    ? ringA.setId && String(ringA.setId) === String(ringB.setId)
    : key !== 'level' && effectiveStat(ringB.stats || {}, key) !== 0);
  const aHelpsB = [...keysB].some((key) => key === 'setBonus'
    ? ringA.setId && String(ringA.setId) === String(ringB.setId)
    : key !== 'level' && effectiveStat(ringA.stats || {}, key) !== 0);
  const conditionComplementarity = bHelpsA || aHelpsB;
  console.log(`TRACE_RING_A_CONDITION_KEYS=${[...keysA].sort().join(',') || 'NONE'}`);
  console.log(`TRACE_RING_B_CONDITION_KEYS=${[...keysB].sort().join(',') || 'NONE'}`);
  console.log(`RING_PAIR_CONDITION_COMPLEMENTARITY=${conditionComplementarity ? 'YES' : 'NO'}`);

  console.log(`PAIR_DIRECT_AP=${effectiveStat(combined, 'ap')}`);
  console.log(`PAIR_DIRECT_MP=${effectiveStat(combined, 'mp')}`);
  console.log(`PAIR_DIRECT_RANGE=${effectiveStat(combined, 'range')}`);
  console.log(`PAIR_CONSTRAINT_PROGRESS=${pairProgress.coverage}`);
  console.log(`PAIR_OFFENSE=${JSON.stringify({ earth: effectiveStat(combined, 'earth'), power: effectiveStat(combined, 'power'), damage: effectiveStat(combined, 'damage'), damageEarth: effectiveStat(combined, 'damageEarth'), crit: effectiveStat(combined, 'crit'), critDamage: effectiveStat(combined, 'critDamage'), minimumScore: witnessPair.syntheticOffense.minimumScore, meanScore: witnessPair.syntheticOffense.meanScore })}`);
  const rank1 = rawPairs[0];
  const rank36 = rawPairs[35];
  console.log(`TRACE_PAIR_RAW_RANK1=${JSON.stringify({ ids: rank1.items.map((item) => String(item.id)), names: rank1.items.map((item) => item.name), stats: rank1.stats, rankScore: rank1.rankScore, offense: rank1.syntheticOffense })}`);
  console.log(`TRACE_PAIR_RAW_RANK36=${JSON.stringify({ ids: rank36.items.map((item) => String(item.id)), names: rank36.items.map((item) => item.name), stats: rank36.stats, rankScore: rank36.rankScore, offense: rank36.syntheticOffense })}`);

  const frozenNonRing = witnessItems.filter((item) => item.slot !== 'ring');
  const meetsApMp = (items) => {
    const stats = fullStaticStats(items, setsById);
    return effectiveStat(stats, 'ap') >= constraints.ap && effectiveStat(stats, 'mp') >= constraints.mp;
  };
  function replacementOracle(targetRing, otherRing) {
    let tested = 0;
    let authoritativeValid = 0;
    let meetingApMp = 0;
    const validExamples = [];
    for (const replacement of ringPool) {
      if (String(replacement.id) === String(otherRing.id)) continue;
      tested++;
      const items = witnessItems.map((item) => String(item.id) === String(targetRing.id) ? replacement : item);
      if (meetsApMp(items)) meetingApMp++;
      const evaluation = evaluateCompleteEquipmentBuild({ items, sets: dataset.sets, constraints, fmPolicy, syntheticOffense });
      if (evaluation.result) {
        authoritativeValid++;
        if (validExamples.length < 8) validExamples.push({ id: String(replacement.id), name: replacement.name, min: evaluation.result.syntheticOffense.minimumScore, mean: evaluation.result.syntheticOffense.meanScore });
      }
    }
    return { tested, authoritativeValid, meetingApMp, validExamples };
  }
  const replaceA = replacementOracle(ringA, ringB);
  const replaceB = replacementOracle(ringB, ringA);
  console.log(`RING_A_REPLACEMENTS_TESTED=${replaceA.tested}`);
  console.log(`RING_A_REPLACEMENTS_AUTHORITATIVE_VALID=${replaceA.authoritativeValid}`);
  console.log(`RING_A_REPLACEMENTS_MEETING_APMP=${replaceA.meetingApMp}`);
  console.log(`TRACE_RING_A_VALID_REPLACEMENT_EXAMPLES=${JSON.stringify(replaceA.validExamples)}`);
  console.log(`RING_B_REPLACEMENTS_TESTED=${replaceB.tested}`);
  console.log(`RING_B_REPLACEMENTS_AUTHORITATIVE_VALID=${replaceB.authoritativeValid}`);
  console.log(`RING_B_REPLACEMENTS_MEETING_APMP=${replaceB.meetingApMp}`);
  console.log(`TRACE_RING_B_VALID_REPLACEMENT_EXAMPLES=${JSON.stringify(replaceB.validExamples)}`);

  const validPairs = [];
  const rejectionCounts = {};
  for (const state of rawPairs) {
    const items = [...frozenNonRing, ...state.items];
    const evaluation = evaluateCompleteEquipmentBuild({ items, sets: dataset.sets, constraints, fmPolicy, syntheticOffense });
    if (evaluation.result) validPairs.push({ state, result: evaluation.result, rawRank: rawRankByKey.get(itemKey(state.items)) });
    else rejectionCounts[evaluation.reason || 'unknown'] = Number(rejectionCounts[evaluation.reason || 'unknown'] || 0) + 1;
  }
  validPairs.sort((a, b) => -compareCompleteEquipmentBuildResults(a.result, b.result));
  const top = validPairs[0] || null;
  const validRanks = validPairs.map((entry) => entry.rawRank).sort((a, b) => a - b);
  const retainedKeys = new Set(retained.map((state) => itemKey(state.items)));
  const retainedFrozenValid = validPairs.filter((entry) => retainedKeys.has(itemKey(entry.state.items))).length;
  console.log(`FROZEN_NON_RING_PAIR_ORACLE_TOTAL=${rawPairs.length}`);
  console.log(`FROZEN_NON_RING_PAIR_ORACLE_VALID=${validPairs.length}`);
  console.log(`FROZEN_NON_RING_PAIR_ORACLE_TOP1_IDS=${top ? top.state.items.map((item) => String(item.id)).sort().join('|') : 'NA'}`);
  console.log(`FROZEN_NON_RING_PAIR_ORACLE_TOP1_NAMES=${top ? top.state.items.map((item) => item.name).sort().join(' | ') : 'NA'}`);
  console.log(`FROZEN_NON_RING_PAIR_ORACLE_TOP1_MIN=${top?.result?.syntheticOffense?.minimumScore ?? 'NA'}`);
  console.log(`FROZEN_NON_RING_PAIR_ORACLE_TOP1_MEAN=${top?.result?.syntheticOffense?.meanScore ?? 'NA'}`);
  console.log(`WITNESS_PAIR_ONLY_VALID_PAIR=${validPairs.length === 1 && itemKey(validPairs[0].state.items) === witnessPairKey ? 'YES' : 'NO'}`);
  console.log(`VALID_PAIR_BEST_RAW_RANK=${validRanks[0] ?? 'NA'}`);
  console.log(`VALID_PAIR_WORST_RAW_RANK=${validRanks.at(-1) ?? 'NA'}`);
  console.log(`VALID_PAIR_COUNT_WITHIN_TOP36=${validRanks.filter((rank) => rank <= 36).length}`);
  console.log(`CURRENT_RETAINED_36_FROZEN_VALID=${retainedFrozenValid}`);
  console.log(`RING_GROUP_REDUCTION_FALSE_NEGATIVE=${validPairs.length > 0 && retainedFrozenValid === 0 ? 'YES' : 'NO'}`);
  console.log(`TRACE_FROZEN_PAIR_REJECTIONS=${JSON.stringify(rejectionCounts)}`);
  console.log(`TRACE_FROZEN_VALID_PAIRS=${JSON.stringify(validPairs.map((entry) => ({ rawRank: entry.rawRank, ids: entry.state.items.map((item) => String(item.id)), names: entry.state.items.map((item) => item.name), min: entry.result.syntheticOffense.minimumScore, mean: entry.result.syntheticOffense.meanScore })))}`);
  console.log(`TRACE_CURRENT_RETAINED_36=${JSON.stringify(retained.map((state) => ({ rawRank: rawRankByKey.get(itemKey(state.items)), ids: state.items.map((item) => String(item.id)), names: state.items.map((item) => item.name), rankScore: state.rankScore, bucket: stateBucket(state, constraints) })))}`);
  console.log('RING_DIAGNOSTIC_END=PASS');
}

ringPairDiagnostic();

const started = performance.now();
const output = searchEquipmentArchitecturesV2({
  items: dataset.items,
  sets: dataset.sets,
  constraints,
  fmPolicy,
  syntheticOffense,
  diagnosticWitnessItemIds: forcedValid ? WITNESS_IDS : [],
  topN,
  searchProfile: 'BALANCED'
});
const wallMs = performance.now() - started;

if (!output.results.length) {
  console.error('REAL_CATALOG_PROBE=FAIL');
  console.error(`REAL_PROBE_CONSTRAINTS=${JSON.stringify(constraints)}`);
  console.error(`REAL_PROBE_EXO_POLICY=${JSON.stringify(fmPolicy)}`);
  console.error(`REAL_PROBE_DIAGNOSTICS=${JSON.stringify(output.diagnostics)}`);
  process.exitCode = 1;
} else {
  for (const [index, result] of output.results.entries()) {
    const structureValid = completeSlotStructureIsValid(result.items);
    const conditionsValid = itemConditionsAreValid(result.items, result.stats, 200);
    const deficits = constraintDeficits(result.stats, constraints);
    const capViolations = permanentStatCapViolations(result.stats, { includeMp: true });
    if (!structureValid || !conditionsValid || Object.keys(deficits).length || capViolations.length) {
      throw new Error(`Returned rank ${index + 1} failed authoritative legality recheck.`);
    }
    console.log(`RANK_${index + 1}_ITEM_IDS=${result.items.map((item) => String(item.id)).sort().join('|')}`);
    console.log(`RANK_${index + 1}_ITEM_NAMES=${result.items.map((item) => item.name).sort().join(' | ')}`);
    console.log(`RANK_${index + 1}_AP=${result.stats.ap}`);
    console.log(`RANK_${index + 1}_MP=${result.stats.mp}`);
    console.log(`RANK_${index + 1}_EARTH=${result.stats.earth || 0}`);
    console.log(`RANK_${index + 1}_POWER=${result.stats.power || 0}`);
    console.log(`RANK_${index + 1}_CRIT=${result.stats.crit || 0}`);
    console.log(`RANK_${index + 1}_CRIT_DAMAGE=${result.stats.critDamage || 0}`);
    console.log(`RANK_${index + 1}_DAMAGE=${result.stats.damage || 0}`);
    console.log(`RANK_${index + 1}_DAMAGE_EARTH=${result.stats.damageEarth || 0}`);
    console.log(`RANK_${index + 1}_MIN=${result.syntheticOffense.minimumScore}`);
    console.log(`RANK_${index + 1}_MEAN=${result.syntheticOffense.meanScore}`);
  }
  console.log('REAL_CATALOG_PROBE=PASS');
  console.log(`REAL_PROBE_SYNTHETIC_REQUEST=${JSON.stringify(syntheticOffense)}`);
  console.log(`REAL_PROBE_CONSTRAINTS=${JSON.stringify(constraints)}`);
  console.log(`REAL_PROBE_EXO_POLICY=${JSON.stringify(fmPolicy)}`);
  console.log(`REAL_PROBE_WALL_MS=${Math.round(wallMs * 1000) / 1000}`);
  console.log(`REAL_PROBE_CANDIDATES=${output.diagnostics.candidateCount}`);
  console.log(`REAL_PROBE_COMPLETE_STATES=${output.diagnostics.completeStates}`);
  console.log(`REAL_PROBE_EVALUATED=${output.diagnostics.evaluated}`);
  console.log(`REAL_PROBE_VALID=${output.diagnostics.valid}`);
  console.log(`REAL_PROBE_HEURISTIC_TRIMMED=${output.diagnostics.heuristicTrimmed}`);
  console.log(`REAL_PROBE_SAFE_PRUNED=${output.diagnostics.safePruned}`);
  console.log(`REAL_PROBE_TOPN=${topN}`);
}
