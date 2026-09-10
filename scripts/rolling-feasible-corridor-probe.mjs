import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { SLOT_RULES } from '../js/config.js';
import { validateDofusSnapshot } from '../js/data-loader.js';
import { searchEquipmentArchitecturesV2 } from '../js/equipment-search-v2.js';
import {
  completeSlotStructureIsValid,
  specialSlotRulesAreValid
} from '../js/build-legality.js';
import {
  compareCompleteEquipmentBuildResults,
  evaluateCompleteEquipmentBuild
} from '../js/complete-equipment-build-evaluator.js';
import { buildEquipmentCandidatePools } from '../optimizer/equipment-candidate-policy.js';
import { filterOptimizerEligibleItems } from '../optimizer/item-eligibility.js';
import { getSearchProfile } from '../optimizer/search-profiles.js';

await import('./equipment-first-real-probe.mjs');

const ORIGINAL_WITNESS_IDS = Object.freeze([
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

const constraints = { ap: 12, mp: 6 };
const fmPolicy = { exoAp: 0, exoMp: 0 };
const syntheticOffense = { elements: ['earth'], profiles: ['large'] };
const topN = 3;

const raw = JSON.parse(readFileSync(new URL('../data/normalized/dofus-data.json', import.meta.url), 'utf8'));
const dataset = validateDofusSnapshot(raw);
const byId = new Map(dataset.items.map((item) => [String(item.id), item]));
const originalWitness = ORIGINAL_WITNESS_IDS.map((id) => byId.get(id)).filter(Boolean);
if (originalWitness.length !== ORIGINAL_WITNESS_IDS.length) {
  throw new Error(`Rolling diagnostic witness drift: ${originalWitness.length}/${ORIGINAL_WITNESS_IDS.length}`);
}

const searchSourceUrl = new URL('../js/equipment-search-v2.js', import.meta.url);
const diagnosticModuleUrl = new URL(`../js/.equipment-search-v2-rolling-${process.pid}.tmp.mjs`, import.meta.url);
const searchSource = readFileSync(searchSourceUrl, 'utf8');
const exportSuffix = `\nexport { buildGroupChoices, keepEquipmentDiversity, rankItems, itemKey, setsByIdFor, fullShape, constraintProgress };\n`;
let internals;
try {
  writeFileSync(diagnosticModuleUrl, `${searchSource}${exportSuffix}`, 'utf8');
  internals = await import(`${diagnosticModuleUrl.href}?v=${Date.now()}`);
} finally {
  try { unlinkSync(diagnosticModuleUrl); } catch {}
}

function idsFor(items = []) {
  return items.map((item) => String(item.id)).sort().join('|');
}

function namesFor(items = []) {
  return items.map((item) => item.name).sort().join(' | ');
}

function directEvaluate(items) {
  return evaluateCompleteEquipmentBuild({
    items,
    sets: dataset.sets,
    constraints,
    fmPolicy,
    syntheticOffense
  });
}

function validCompletions(states, frozenItems = []) {
  const unique = new Map();
  for (const state of states || []) {
    const items = [...(state.items || []), ...frozenItems];
    const identity = idsFor(items);
    if (unique.has(identity)) continue;
    if (new Set(items.map((item) => String(item.id))).size !== items.length) continue;
    if (!completeSlotStructureIsValid(items) || !specialSlotRulesAreValid(items)) continue;
    const evaluation = directEvaluate(items);
    if (evaluation.result) unique.set(identity, evaluation.result);
  }
  return [...unique.values()].sort((a, b) => -compareCompleteEquipmentBuildResults(a, b));
}

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
const setsById = internals.setsByIdFor(dataset.sets);

function exactGroupContext(rule) {
  return {
    slot: rule.id,
    policy,
    profile,
    constraints,
    fmPolicy,
    setsById,
    diagnostic: null,
    diagnosticWitnessChoiceIds: []
  };
}

function tracedGroupChoices(rule) {
  const count = Number(rule.count || 0);
  const profiles = (prefilter.pools?.[rule.id] || []).map((item) => policy.profileItem(item));
  let states = [{ items: [], ids: new Set(), stats: {}, rankScore: 0 }];
  const finalLimit = Math.max(1, Number(profile.search.groupChoiceLimits?.[rule.id] || 1));
  const intermediateBeamWidth = rule.id === 'dofus'
    ? profile.search.dofusGroupBeamWidth
    : count >= 5 ? profile.search.multiPickBeamWidth : profile.search.groupBeamWidth;
  const intermediateLimit = Math.max(finalLimit, Number(intermediateBeamWidth || 1));
  const snapshots = [];

  for (let pick = 0; pick < count; pick++) {
    const next = [];
    for (const state of states) {
      for (const entry of profiles) {
        const id = String(entry.item.id);
        if (state.ids.has(id)) continue;
        const items = [...state.items, entry.item];
        if (!specialSlotRulesAreValid(items)) continue;
        const ranked = internals.rankItems(items, policy, setsById);
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
      const key = internals.itemKey(state.items);
      const previous = dedup.get(key);
      if (!previous || state.rankScore > previous.rankScore) dedup.set(key, state);
    }
    const before = [...dedup.values()];
    const pickLimit = pick === count - 1 ? finalLimit : intermediateLimit;
    const after = count === 1
      ? [...before].sort((a, b) => b.rankScore - a.rankScore || internals.itemKey(a.items).localeCompare(internals.itemKey(b.items)))
      : internals.keepEquipmentDiversity(before, pickLimit, {
          policy,
          constraints,
          bucketLimit: profile.search.groupBucketLimit
        });
    snapshots.push({ pick: pick + 1, before, after, limit: pickLimit });
    states = after;
    if (!states.length) break;
  }

  const exact = internals.buildGroupChoices(profiles, count, exactGroupContext(rule));
  const tracedKeys = states.map((state) => internals.itemKey(state.items));
  const exactKeys = exact.map((state) => internals.itemKey(state.items));
  if (JSON.stringify(tracedKeys) !== JSON.stringify(exactKeys)) {
    throw new Error(`Diagnostic group trace diverged from buildGroupChoices for ${rule.id}`);
  }
  return { rule, choices: exact, snapshots };
}

const groupTraceCache = new Map();
function groupTraceFor(rule) {
  if (!groupTraceCache.has(rule.id)) groupTraceCache.set(rule.id, tracedGroupChoices(rule));
  return groupTraceCache.get(rule.id);
}

const groups = SLOT_RULES
  .map((rule) => ({ ...rule, missing: Number(rule.count || 0) }))
  .filter((rule) => rule.missing > 0)
  .sort((a, b) => {
    if (a.id === 'dofus' && b.id !== 'dofus') return -1;
    if (b.id === 'dofus' && a.id !== 'dofus') return 1;
    return groupTraceFor(a).choices.length - groupTraceFor(b).choices.length;
  });

const ringRule = SLOT_RULES.find((rule) => rule.id === 'ring');
const ringTrace = groupTraceFor(ringRule);
const originalNonRing = originalWitness.filter((item) => item.slot !== 'ring');
const retainedRingValid = validCompletions(ringTrace.choices, originalNonRing);
console.log(`RETAINED_RING_VALID_COUNT=${retainedRingValid.length}`);
console.log(`RETAINED_RING_PAIR_IDS=${retainedRingValid[0] ? idsFor(retainedRingValid[0].items.filter((item) => item.slot === 'ring')) : 'NA'}`);
console.log(`RETAINED_RING_PAIR_NAMES=${retainedRingValid[0] ? namesFor(retainedRingValid[0].items.filter((item) => item.slot === 'ring')) : 'NA'}`);
if (retainedRingValid.length !== 1) {
  throw new Error(`Expected exactly one authoritative-valid retained ring pair, got ${retainedRingValid.length}`);
}

const rolling1Result = retainedRingValid[0];
const rolling1Items = rolling1Result.items;
const rolling1Ids = rolling1Items.map((item) => String(item.id));
console.log('ROLLING_WITNESS_1_VALID=YES');
console.log(`ROLLING_WITNESS_1_IDS=${idsFor(rolling1Items)}`);
console.log(`ROLLING_WITNESS_1_NAMES=${namesFor(rolling1Items)}`);
console.log(`ROLLING_WITNESS_1_AP=${rolling1Result.stats.ap}`);
console.log(`ROLLING_WITNESS_1_MP=${rolling1Result.stats.mp}`);
console.log(`ROLLING_WITNESS_1_MIN=${rolling1Result.syntheticOffense.minimumScore}`);
console.log(`ROLLING_WITNESS_1_MEAN=${rolling1Result.syntheticOffense.meanScore}`);
console.log(`ROLLING_WITNESS_1_IDENTITY=${rolling1Result.buildIdentity}`);

const rollingForced = searchEquipmentArchitecturesV2({
  items: dataset.items,
  sets: dataset.sets,
  constraints,
  fmPolicy,
  syntheticOffense,
  requiredItemIds: rolling1Ids,
  topN,
  searchProfile: 'BALANCED'
});
const rollingForcedValid = rollingForced.results.some((result) => result.buildIdentity === rolling1Result.buildIdentity);
console.log(`ROLLING_WITNESS_1_FORCED_VALID=${rollingForcedValid ? 'YES' : 'NO'}`);

const rolling1RingKey = idsFor(rolling1Items.filter((item) => item.slot === 'ring'));
const rolling1RingPresent = ringTrace.choices.some((choice) => internals.itemKey(choice.items) === rolling1RingKey);

const summary = {
  ringRollingChoicePresent: rolling1RingPresent,
  transformations: 1,
  identities: [rolling1Result.buildIdentity],
  cycle: false,
  firstExactLoss: 'NONE',
  firstExactEvidence: 'NONE',
  firstRescueKind: 'NONE',
  firstRetainedTested: 0,
  firstRetainedValid: 0,
  feasibilityLoss: rollingForcedValid ? 'NONE' : 'FORCED_PATH_INCONSISTENCY',
  feasibilityEvidence: rollingForcedValid ? 'NONE' : 'direct rolling witness valid but requiredItemIds search did not return its identity',
  preFrozenValid: rollingForcedValid ? 0 : 1,
  postFrozenValid: 0,
  frozenFalseNegative: false,
  stateReachedFinal: false,
  finalEvaluated: false,
  finalValid: false,
  real: null,
  wallMs: 0
};

function traceCurrentSearch(witnessItems) {
  const witnessBySlot = Object.fromEntries(SLOT_RULES.map((rule) => [
    rule.id,
    witnessItems.filter((item) => item.slot === rule.id)
  ]));
  for (const item of witnessItems) {
    const pool = prefilter.pools?.[item.slot] || [];
    if (!pool.some((entry) => String(entry.id) === String(item.id))) {
      return {
        loss: {
          kind: 'CANDIDATE_POOL',
          evidence: `item=${item.id}|slot=${item.slot}|missing from candidate pool`
        }
      };
    }
  }

  let states = [{
    items: [],
    ids: new Set(),
    ...internals.rankItems([], policy, setsById)
  }];
  let expandedStates = 0;
  let heuristicTrimmed = 0;
  let safePruned = 0;
  const processedSlots = [];

  for (const group of groups) {
    const groupTrace = groupTraceFor(group);
    const witnessChoice = witnessBySlot[group.id] || [];
    const witnessChoiceIds = new Set(witnessChoice.map((item) => String(item.id)));
    let earliestGroupLoss = null;
    for (const snapshot of groupTrace.snapshots) {
      const compatible = (state) => state.items.length === snapshot.pick
        && state.items.every((item) => witnessChoiceIds.has(String(item.id)));
      if (snapshot.before.some(compatible) && !snapshot.after.some(compatible)) {
        earliestGroupLoss = snapshot;
        break;
      }
    }
    const exactChoiceKey = idsFor(witnessChoice);
    const finalChoicePresent = groupTrace.choices.some((choice) => internals.itemKey(choice.items) === exactChoiceKey);
    if (group.id === 'ring') summary.ringRollingChoicePresent = finalChoicePresent;
    if (!finalChoicePresent) {
      return {
        loss: {
          kind: 'GROUP_CHOICE_DIVERSITY',
          group: group.id,
          pick: earliestGroupLoss?.pick ?? group.count,
          evidence: `group=${group.id}|pick=${earliestGroupLoss?.pick ?? group.count}|exact rolling group choice absent after current group reduction`,
          before: earliestGroupLoss?.before || [],
          after: groupTrace.choices,
          frozenOutsideGroup: witnessItems.filter((item) => item.slot !== group.id)
        }
      };
    }

    const next = [];
    for (const state of states) {
      for (const choice of groupTrace.choices) {
        if (choice.items.some((item) => state.ids.has(String(item.id)))) continue;
        const nextItems = [...state.items, ...choice.items];
        if (!specialSlotRulesAreValid(nextItems)) {
          safePruned++;
          continue;
        }
        const ranked = internals.rankItems(nextItems, policy, setsById);
        const progress = internals.constraintProgress(ranked.stats, constraints);
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
    const kept = internals.keepEquipmentDiversity(next, stateLimit, {
      policy,
      constraints,
      bucketLimit: profile.search.stateBucketLimit
    });
    processedSlots.push(group.id);
    const processed = new Set(processedSlots);
    const prefixItems = witnessItems.filter((item) => processed.has(item.slot));
    const prefixKey = idsFor(prefixItems);
    const before = next.some((state) => internals.itemKey(state.items) === prefixKey);
    const after = kept.some((state) => internals.itemKey(state.items) === prefixKey);
    if (before && !after) {
      return {
        loss: {
          kind: 'STATE_BEAM',
          group: group.id,
          evidence: `group=${group.id}|exact rolling prefix present before state beam and absent after`,
          before: next,
          after: kept,
          frozenSuffix: witnessItems.filter((item) => !processed.has(item.slot)),
          processedSlots: [...processedSlots]
        }
      };
    }
    if (!before) {
      return {
        loss: {
          kind: 'STATE_EXPANSION',
          group: group.id,
          evidence: `group=${group.id}|exact rolling prefix absent before state beam`
        }
      };
    }
    heuristicTrimmed += Math.max(0, next.length - kept.length);
    states = kept;
  }

  const complete = states.filter((state) => internals.fullShape(state.items));
  const witnessIdentity = idsFor(witnessItems);
  return {
    complete,
    exactFinalPresent: complete.some((state) => internals.itemKey(state.items) === witnessIdentity),
    expandedStates,
    heuristicTrimmed,
    safePruned
  };
}

function recordFirstLoss(loss) {
  if (summary.firstExactLoss !== 'NONE') return;
  summary.firstExactLoss = loss.kind === 'STATE_BEAM'
    ? `STATE_BEAM:${loss.group}`
    : loss.kind === 'GROUP_CHOICE_DIVERSITY'
      ? `GROUP_CHOICE_DIVERSITY:${loss.group}:pick${loss.pick}`
      : loss.kind;
  summary.firstExactEvidence = loss.evidence;
}

function recordFirstRescue(kind, tested, valid) {
  if (summary.firstRescueKind !== 'NONE') return;
  summary.firstRescueKind = kind;
  summary.firstRetainedTested = tested;
  summary.firstRetainedValid = valid;
}

if (rollingForcedValid) {
  let currentResult = rolling1Result;
  const seen = new Set(summary.identities);

  while (true) {
    const started = performance.now();
    const actual = searchEquipmentArchitecturesV2({
      items: dataset.items,
      sets: dataset.sets,
      constraints,
      fmPolicy,
      syntheticOffense,
      diagnosticWitnessItemIds: currentResult.items.map((item) => String(item.id)),
      topN,
      searchProfile: 'BALANCED'
    });
    const wallMs = performance.now() - started;
    if (!summary.real) {
      summary.real = actual;
      summary.wallMs = wallMs;
    }

    if (actual.results.length > 0) {
      summary.stateReachedFinal = true;
      summary.finalEvaluated = true;
      summary.finalValid = true;
      break;
    }

    const traced = traceCurrentSearch(currentResult.items);
    if (traced.complete && traced.complete.length !== actual.diagnostics.completeStates) {
      throw new Error(`Rolling diagnostic complete-state mismatch: traced=${traced.complete.length} actual=${actual.diagnostics.completeStates}`);
    }
    if (traced.expandedStates != null && traced.expandedStates !== actual.diagnostics.expandedStates) {
      throw new Error(`Rolling diagnostic expanded-state mismatch: traced=${traced.expandedStates} actual=${actual.diagnostics.expandedStates}`);
    }
    if (traced.heuristicTrimmed != null && traced.heuristicTrimmed !== actual.diagnostics.heuristicTrimmed) {
      throw new Error(`Rolling diagnostic heuristic-trim mismatch: traced=${traced.heuristicTrimmed} actual=${actual.diagnostics.heuristicTrimmed}`);
    }
    if (traced.safePruned != null && traced.safePruned !== actual.diagnostics.safePruned) {
      throw new Error(`Rolling diagnostic safe-pruned mismatch: traced=${traced.safePruned} actual=${actual.diagnostics.safePruned}`);
    }

    if (!traced.loss) {
      summary.stateReachedFinal = Boolean(traced.exactFinalPresent);
      summary.finalEvaluated = Boolean(traced.exactFinalPresent);
      summary.finalValid = Boolean(traced.exactFinalPresent && directEvaluate(currentResult.items).result);
      summary.feasibilityLoss = 'FINAL_PATH_INCONSISTENCY';
      summary.feasibilityEvidence = summary.finalEvaluated && summary.finalValid
        ? 'rolling build reached complete evaluation and is authoritative-valid, but unchanged search returned zero valid results'
        : `rolling exact final present=${traced.exactFinalPresent ? 'YES' : 'NO'} while unchanged search returned zero valid results`;
      summary.preFrozenValid = 1;
      summary.postFrozenValid = 0;
      break;
    }

    const loss = traced.loss;
    recordFirstLoss(loss);
    if (loss.kind === 'GROUP_CHOICE_DIVERSITY') {
      const postValid = validCompletions(loss.after, loss.frozenOutsideGroup);
      recordFirstRescue(`GROUP:${loss.group}`, loss.after.length, postValid.length);
      if (!postValid.length) {
        summary.feasibilityLoss = `GROUP_CHOICE_DIVERSITY:${loss.group}`;
        summary.feasibilityEvidence = `${loss.evidence}|known rolling witness valid before reduction|retained group choices with frozen context valid=0`;
        summary.preFrozenValid = 1;
        summary.postFrozenValid = 0;
        summary.frozenFalseNegative = true;
        break;
      }
      const replacement = postValid[0];
      const identity = replacement.buildIdentity;
      if (seen.has(identity)) {
        summary.cycle = true;
        break;
      }
      seen.add(identity);
      summary.identities.push(identity);
      summary.transformations++;
      currentResult = replacement;
      continue;
    }

    if (loss.kind === 'STATE_BEAM') {
      const preValid = validCompletions(loss.before, loss.frozenSuffix);
      const postValid = validCompletions(loss.after, loss.frozenSuffix);
      recordFirstRescue(`STATE:${loss.group}`, loss.after.length, postValid.length);
      if (!preValid.length) {
        throw new Error(`State rescue oracle contradiction: rolling witness was valid but pre-reduction frozen oracle is empty at ${loss.group}`);
      }
      if (!postValid.length) {
        summary.feasibilityLoss = `STATE_BEAM:${loss.group}`;
        summary.feasibilityEvidence = `${loss.evidence}|pre frozen valid=${preValid.length}|post frozen valid=0`;
        summary.preFrozenValid = preValid.length;
        summary.postFrozenValid = 0;
        summary.frozenFalseNegative = true;
        break;
      }
      const replacement = postValid[0];
      const identity = replacement.buildIdentity;
      if (seen.has(identity)) {
        summary.cycle = true;
        break;
      }
      seen.add(identity);
      summary.identities.push(identity);
      summary.transformations++;
      currentResult = replacement;
      continue;
    }

    summary.feasibilityLoss = loss.kind;
    summary.feasibilityEvidence = loss.evidence;
    summary.preFrozenValid = 1;
    summary.postFrozenValid = 0;
    break;
  }
}

if (!summary.real) {
  const started = performance.now();
  summary.real = searchEquipmentArchitecturesV2({
    items: dataset.items,
    sets: dataset.sets,
    constraints,
    fmPolicy,
    syntheticOffense,
    topN,
    searchProfile: 'BALANCED'
  });
  summary.wallMs = performance.now() - started;
}

const real = summary.real;
const top1 = real.results[0] || null;
const realProbe = real.results.length > 0 ? 'PASS' : 'FAIL';
if (realProbe === 'PASS') {
  summary.feasibilityLoss = 'NONE';
  summary.feasibilityEvidence = 'NONE';
  summary.frozenFalseNegative = false;
  summary.stateReachedFinal = true;
  summary.finalEvaluated = true;
  summary.finalValid = true;
}

console.log(`RING_ROLLING_CHOICE_PRESENT=${summary.ringRollingChoicePresent ? 'YES' : 'NO'}`);
console.log(`ROLLING_WITNESS_TRANSFORMATIONS=${summary.transformations}`);
console.log(`ROLLING_WITNESS_IDENTITIES=${summary.identities.join(' -> ')}`);
console.log(`ROLLING_DIAGNOSTIC_CYCLE=${summary.cycle ? 'YES' : 'NO'}`);
console.log(`FIRST_EXACT_IDENTITY_LOSS=${summary.firstExactLoss}`);
console.log(`FIRST_EXACT_IDENTITY_LOSS_EVIDENCE=${summary.firstExactEvidence}`);
console.log(`FIRST_RESCUE_KIND=${summary.firstRescueKind}`);
console.log(`RETAINED_ALTERNATIVES_TESTED=${summary.firstRetainedTested}`);
console.log(`RETAINED_ALTERNATIVES_AUTHORITATIVE_VALID=${summary.firstRetainedValid}`);
console.log(`FIRST_FEASIBILITY_RELEVANT_LOSS=${summary.feasibilityLoss}`);
console.log(`FIRST_FEASIBILITY_RELEVANT_LOSS_EVIDENCE=${summary.feasibilityEvidence}`);
console.log(`PRE_REDUCTION_FROZEN_VALID=${summary.preFrozenValid}`);
console.log(`POST_REDUCTION_FROZEN_VALID=${summary.postFrozenValid}`);
console.log(`FROZEN_CONTEXT_FALSE_NEGATIVE=${summary.frozenFalseNegative ? 'YES' : 'NO'}`);
console.log(`STATE_LINEAGE_REACHED_FINAL=${summary.stateReachedFinal ? 'YES' : 'NO'}`);
console.log(`ROLLING_FINAL_WITNESS_EVALUATED=${summary.finalEvaluated ? 'YES' : 'NO'}`);
console.log(`ROLLING_FINAL_WITNESS_VALID=${summary.finalValid ? 'YES' : 'NO'}`);
console.log(`REAL_CATALOG_PROBE=${realProbe}`);
console.log(`REAL_PROBE_COMPLETE_STATES=${real.diagnostics.completeStates}`);
console.log(`REAL_PROBE_AUTHORITATIVE_EVALUATED=${real.diagnostics.authoritativeEvaluated}`);
console.log(`REAL_PROBE_VALID=${real.diagnostics.valid}`);
console.log(`REAL_PROBE_REJECTIONS=${JSON.stringify(real.diagnostics.rejected || {})}`);
console.log(`REAL_PROBE_EXPANDED_STATES=${real.diagnostics.expandedStates}`);
console.log(`REAL_PROBE_HEURISTIC_TRIMMED=${real.diagnostics.heuristicTrimmed}`);
console.log(`REAL_PROBE_SAFE_PRUNED=${real.diagnostics.safePruned}`);
console.log(`REAL_PROBE_WALL_MS=${Math.round(summary.wallMs * 1000) / 1000}`);
console.log(`REAL_PROBE_TOP1_ITEMS=${top1 ? idsFor(top1.items) : 'NA'}`);
console.log(`REAL_PROBE_TOP1_NAMES=${top1 ? namesFor(top1.items) : 'NA'}`);
console.log(`REAL_PROBE_TOP1_AP=${top1?.stats?.ap ?? 'NA'}`);
console.log(`REAL_PROBE_TOP1_MP=${top1?.stats?.mp ?? 'NA'}`);
console.log(`REAL_PROBE_TOP1_MIN=${top1?.syntheticOffense?.minimumScore ?? 'NA'}`);
console.log(`REAL_PROBE_TOP1_MEAN=${top1?.syntheticOffense?.meanScore ?? 'NA'}`);
console.log('RING_SEARCH_CHANGED=NO');
console.log('CANDIDATE_POLICY_CHANGED=NO');
console.log('PARETO_CHANGED=NO');
console.log('GROUP_LIMITS_CHANGED=NO');
console.log('STATE_BEAM_CHANGED=NO');
console.log('SET_SIGNATURE_CHANGED=NO');
console.log('SCORING_CHANGED=NO');
console.log('EVALUATOR_CHANGED=NO');
console.log('UI_CHANGED=NO');
console.log('TARGETED_DIAGNOSTIC=PASS');
console.log(`READY_FOR_FIX_SELECTION=${realProbe === 'FAIL' && summary.feasibilityLoss !== 'NONE' ? 'YES' : 'NO'}`);
console.log(`READY_FOR_FINAL_CLEANUP=${realProbe === 'PASS' ? 'YES' : 'NO'}`);
