import { SLOT_RULES } from './config.js';
import { specialSlotRulesAreValid } from './build-legality.js';
import { evaluateCompleteBuild } from './complete-build-evaluator.js';
import { effectiveStat, positiveConstraintContribution } from './stats.js';
import {
  branchFeasibility,
  createBranchFeasibilityEnvelope,
  offensiveUpperBound,
  staticBuildStats
} from '../optimizer/candidate-search.js';
import { createCandidatePolicy, positiveConstraintKeys } from '../optimizer/candidate-policy.js';
import { rankSetCoresForPolicy } from '../optimizer/set-core-catalog.js';
import { filterOptimizerEligibleItems } from '../optimizer/item-eligibility.js';

const STRUCTURAL_CONSTRAINT_KEYS = new Set(['ap', 'mp', 'range']);
const EQUIPMENT_SLOTS = new Set(['hat', 'cape', 'amulet', 'belt', 'boots', 'weapon', 'ring', 'shield']);
const EQUIPMENT_TIE_ORDER = new Map([
  ['hat', 0], ['cape', 1], ['amulet', 2], ['belt', 3],
  ['boots', 4], ['weapon', 5], ['ring', 6], ['shield', 7]
]);
const PROGRESS_NODE_INTERVAL = 4096;
const SCORE_EPSILON = 1e-9;
const DEBUG_HINT_LIMIT = 8;

function clockMs() {
  return typeof globalThis.performance?.now === 'function' ? globalThis.performance.now() : Date.now();
}
function resultKey(result) {
  return (result?.items || []).map((item) => String(item.id)).sort().join('|');
}
function normalizeIds(values = []) {
  return [...new Set((values || []).map(String).filter(Boolean))];
}
function addCount(target, key) {
  target.set(key, (target.get(key) || 0) + 1);
}
function inactiveDiagnostics() {
  return {
    constraintRescueUsed: false,
    constraintRescueGroupOrder: [],
    constraintRescueFirstIncumbentAtNode: null,
    constraintRescueNodes: 0,
    constraintRescueLeaves: 0,
    constraintRescuePruned: 0,
    constraintRescueEvaluated: 0,
    constraintRescueValid: 0,
    constraintRescueElapsedMs: 0,
    constraintRescueExhausted: false
  };
}
export function emptyConstraintRescueDiagnostics() {
  return inactiveDiagnostics();
}
export function shouldUseConstraintCompletenessRescue({ results = [], constraints = {} } = {}) {
  return (results || []).length === 0 && positiveConstraintKeys(constraints).length > 0;
}
function chooseCount(n, k) {
  const count = Math.max(0, Number(k || 0));
  const size = Math.max(0, Number(n || 0));
  if (count > size) return Infinity;
  const picked = Math.min(count, size - count);
  let value = 1;
  for (let index = 1; index <= picked; index++) {
    value *= (size - picked + index) / index;
    if (!Number.isFinite(value)) return Infinity;
  }
  return value;
}
function noCritExplorationContext(scenario = {}) {
  return scenario?.noCrit === true
    || String(scenario?.critMode || '').toLowerCase() === 'no-crit'
    || String(scenario?.criticalMode || '').toLowerCase() === 'no-crit';
}
function explorationStats(stats = {}, noCrit = false) {
  if (!noCrit) return stats;
  return { ...stats, crit: -1000, critDamage: 0 };
}
function candidateConstraintOrder(profile, constraints = {}) {
  let structural = 0;
  let other = 0;
  for (const key of positiveConstraintKeys(constraints)) {
    const target = Math.max(1, Number(constraints[key] || 0));
    const contribution = Math.max(0, positiveConstraintContribution(profile.optimisticStats || {}, key));
    const normalized = Math.min(1, contribution / target);
    if (STRUCTURAL_CONSTRAINT_KEYS.has(key)) structural += normalized;
    else other += normalized;
  }
  return { structural, other, offense: Number(profile.rankScore || 0) };
}
function sortProfilesForExploration(profiles = [], constraints = {}) {
  return [...profiles].sort((left, right) => {
    const a = candidateConstraintOrder(left, constraints);
    const b = candidateConstraintOrder(right, constraints);
    return b.structural - a.structural
      || b.other - a.other
      || b.offense - a.offense
      || String(left.item.id).localeCompare(String(right.item.id));
  });
}
function normalizedConstraintCoverage(stats = {}, constraints = {}) {
  let score = 0;
  for (const key of positiveConstraintKeys(constraints)) {
    const target = Math.max(1, Number(constraints[key] || 0));
    const value = Math.max(0, positiveConstraintContribution(stats, key));
    const normalized = Math.min(1, value / target);
    score += STRUCTURAL_CONSTRAINT_KEYS.has(key) ? normalized * 2 : normalized;
  }
  return score;
}
function groupConstraintPotential(group, constraints = {}) {
  const keys = positiveConstraintKeys(constraints);
  if (!keys.length) return 0;
  let score = 0;
  for (const key of keys) {
    const target = Math.max(1, Number(constraints[key] || 0));
    const values = (group.profiles || [])
      .map((profile) => Math.max(0, positiveConstraintContribution(profile.optimisticStats || {}, key)))
      .sort((a, b) => b - a);
    for (let index = 0; index < group.missing; index++) {
      const normalized = Math.min(1, Number(values[index] || 0) / target);
      score += STRUCTURAL_CONSTRAINT_KEYS.has(key) ? normalized * 2 : normalized;
    }
  }
  return score;
}
function sortGroupsLegacy(groups = [], constraints = {}) {
  return [...groups].sort((left, right) => {
    const potential = groupConstraintPotential(right, constraints) - groupConstraintPotential(left, constraints);
    if (Math.abs(potential) > SCORE_EPSILON) return potential;
    const leftChoices = chooseCount(left.profiles.length, left.missing);
    const rightChoices = chooseCount(right.profiles.length, right.missing);
    return leftChoices - rightChoices || left.id.localeCompare(right.id);
  });
}
function requiredState(eligibleItems = [], requiredItemIds = [], rejectedItemIds = []) {
  const requiredIds = normalizeIds(requiredItemIds);
  const rejected = new Set(normalizeIds(rejectedItemIds));
  const byId = new Map((eligibleItems || []).map((item) => [String(item.id), item]));
  const missingIds = requiredIds.filter((id) => !byId.has(id));
  const rejectedRequiredIds = requiredIds.filter((id) => rejected.has(id));
  if (missingIds.length || rejectedRequiredIds.length) {
    return { valid: false, requiredIds, items: [], reason: missingIds.length ? 'required-missing' : 'required-rejected' };
  }
  const items = requiredIds.map((id) => byId.get(id));
  const counts = new Map();
  for (const item of items) counts.set(item.slot, (counts.get(item.slot) || 0) + 1);
  for (const rule of SLOT_RULES) {
    if ((counts.get(rule.id) || 0) > Number(rule.count || 0)) {
      return { valid: false, requiredIds, items, reason: 'required-slot-overflow' };
    }
  }
  if (!specialSlotRulesAreValid(items)) {
    return { valid: false, requiredIds, items, reason: 'required-special-slot' };
  }
  return { valid: true, requiredIds, items, reason: null };
}
function makeDiagnostics({
  used,
  nodes,
  leaves,
  pruned,
  evaluated,
  valid,
  exhausted,
  eligibleItems,
  pruneReasons,
  groupOrder,
  firstIncumbentAtNode,
  startedAt,
  reason = null,
  debugHints = null
}) {
  const diagnostics = {
    constraintRescueUsed: Boolean(used),
    constraintRescueGroupOrder: [...(groupOrder || [])],
    constraintRescueFirstIncumbentAtNode: firstIncumbentAtNode ?? null,
    constraintRescueNodes: Number(nodes || 0),
    constraintRescueLeaves: Number(leaves || 0),
    constraintRescuePruned: Number(pruned || 0),
    constraintRescueEvaluated: Number(evaluated || 0),
    constraintRescueValid: Number(valid || 0),
    constraintRescueElapsedMs: Math.round(Math.max(0, clockMs() - Number(startedAt || clockMs())) * 1000) / 1000,
    constraintRescueExhausted: Boolean(exhausted),
    constraintRescueEligibleItems: Number(eligibleItems || 0),
    constraintRescueReason: reason,
    constraintRescuePruneReasons: Object.fromEntries(pruneReasons || [])
  };
  if (debugHints) Object.assign(diagnostics, debugHints);
  return diagnostics;
}
function rankSetExploration(policy, constraints = {}, noCrit = false) {
  const ranked = rankSetCoresForPolicy(policy.setCoreCatalog, policy, { limit: Infinity }).selected
    .map((core) => {
      const adjusted = explorationStats(core.searchStats || core.aggregateStats || {}, noCrit);
      const rankedStats = policy.rankStats(adjusted);
      return {
        ...core,
        explorationOffense: Number(noCrit ? rankedStats.rankScore : core.searchScore || rankedStats.rankScore || 0),
        explorationConstraint: normalizedConstraintCoverage(core.searchStats || core.aggregateStats || {}, constraints)
      };
    });
  const hasConstraints = positiveConstraintKeys(constraints).length > 0;
  ranked.sort((a, b) => (hasConstraints ? b.explorationConstraint - a.explorationConstraint : 0)
    || b.explorationOffense - a.explorationOffense
    || b.pieceCount - a.pieceCount
    || String(a.id).localeCompare(String(b.id)));
  const byItem = new Map();
  ranked.forEach((core, rank) => {
    for (const id of core.itemIds || []) {
      const key = String(id);
      const entry = {
        rank,
        coreId: core.id,
        setId: core.setId,
        score: Number(core.explorationOffense || 0),
        constraint: Number(core.explorationConstraint || 0)
      };
      const previous = byItem.get(key);
      if (!previous || entry.rank < previous.rank) byItem.set(key, entry);
    }
  });
  return { ranked, byItem };
}
function sortEquipmentProfiles(profiles = [], constraints = {}, setByItem = new Map()) {
  const hasConstraints = positiveConstraintKeys(constraints).length > 0;
  return [...profiles].sort((left, right) => {
    const aDirect = candidateConstraintOrder(left, constraints);
    const bDirect = candidateConstraintOrder(right, constraints);
    const aSet = setByItem.get(String(left.item.id));
    const bSet = setByItem.get(String(right.item.id));
    const aConstraint = aDirect.structural * 2 + aDirect.other + Number(aSet?.constraint || 0);
    const bConstraint = bDirect.structural * 2 + bDirect.other + Number(bSet?.constraint || 0);
    if (hasConstraints && Math.abs(bConstraint - aConstraint) > SCORE_EPSILON) return bConstraint - aConstraint;
    const aSetRank = aSet ? 1 / (1 + aSet.rank) : 0;
    const bSetRank = bSet ? 1 / (1 + bSet.rank) : 0;
    if (Math.abs(bSetRank - aSetRank) > SCORE_EPSILON) return bSetRank - aSetRank;
    const aSetScore = Number(aSet?.score || 0);
    const bSetScore = Number(bSet?.score || 0);
    return bSetScore - aSetScore
      || Number(right.rankScore || 0) - Number(left.rankScore || 0)
      || String(left.item.id).localeCompare(String(right.item.id));
  });
}
function guidedGroupCategory(group) {
  if (EQUIPMENT_SLOTS.has(group.id)) return 0;
  if (group.id === 'companion') return 1;
  if (group.id === 'dofus') return 2;
  return 1;
}
function groupSetPriority(group, setByItem) {
  let best = 0;
  for (const profile of group.profiles || []) {
    const set = setByItem.get(String(profile.item.id));
    if (set) best = Math.max(best, 1 / (1 + set.rank));
  }
  return best;
}
function groupSetConstraint(group, setByItem) {
  let best = 0;
  for (const profile of group.profiles || []) {
    best = Math.max(best, Number(setByItem.get(String(profile.item.id))?.constraint || 0));
  }
  return best;
}
function sortGroupsGuidedT1(groups = [], constraints = {}, setByItem = new Map()) {
  const hasConstraints = positiveConstraintKeys(constraints).length > 0;
  return [...groups].sort((left, right) => {
    const category = guidedGroupCategory(left) - guidedGroupCategory(right);
    if (category) return category;
    if (guidedGroupCategory(left) === 0) {
      const leftConstraint = groupConstraintPotential(left, constraints) + groupSetConstraint(left, setByItem);
      const rightConstraint = groupConstraintPotential(right, constraints) + groupSetConstraint(right, setByItem);
      if (hasConstraints && Math.abs(rightConstraint - leftConstraint) > SCORE_EPSILON) return rightConstraint - leftConstraint;
      const setPotential = groupSetPriority(right, setByItem) - groupSetPriority(left, setByItem);
      if (Math.abs(setPotential) > SCORE_EPSILON) return setPotential;
      const leftChoices = chooseCount(left.profiles.length, left.missing);
      const rightChoices = chooseCount(right.profiles.length, right.missing);
      if (leftChoices !== rightChoices) return leftChoices - rightChoices;
      return Number(EQUIPMENT_TIE_ORDER.get(left.id) ?? 99) - Number(EQUIPMENT_TIE_ORDER.get(right.id) ?? 99)
        || left.id.localeCompare(right.id);
    }
    return left.id.localeCompare(right.id);
  });
}
function deficitGain(current = {}, projected = {}, constraints = {}) {
  let total = 0;
  for (const key of positiveConstraintKeys(constraints)) {
    const target = Math.max(1, Number(constraints[key] || 0));
    const before = Number(effectiveStat(current, key) || 0);
    const after = Number(effectiveStat(projected, key) || 0);
    const deficit = Math.max(0, target - before);
    if (!(deficit > 0)) continue;
    const gain = Math.min(deficit, Math.max(0, after - before)) / target;
    total += STRUCTURAL_CONSTRAINT_KEYS.has(key) ? gain * 2 : gain;
  }
  return total;
}
function dynamicProfileMetric(profile, selectedItems, setsById, policy, constraints, noCrit, kind) {
  const current = staticBuildStats(selectedItems, setsById);
  const projected = staticBuildStats([...selectedItems, profile.item], setsById);
  const currentRank = policy.rankStats(explorationStats(current, noCrit));
  const projectedRank = policy.rankStats(explorationStats(projected, noCrit));
  const optimisticRank = policy.rankStats(explorationStats(profile.optimisticStats || {}, noCrit));
  return {
    deficit: deficitGain(current, projected, constraints),
    objectiveGain: Number(projectedRank.objective || 0) - Number(currentRank.objective || 0),
    optimistic: Number(noCrit ? optimisticRank.rankScore : profile.rankScore || optimisticRank.rankScore || 0),
    prysmaradite: kind === 'dofus' && profile.item?.slotSubtype === 'prysmaradite' ? 1 : 0
  };
}
function dynamicProfilesForGroup(group, selectedItems, setsById, policy, constraints, noCrit, debugHints) {
  if (!['companion', 'dofus'].includes(group.id)) return group.profiles;
  const metrics = new Map();
  for (const profile of group.profiles) {
    metrics.set(profile, dynamicProfileMetric(profile, selectedItems, setsById, policy, constraints, noCrit, group.id));
  }
  const ordered = [...group.profiles].sort((left, right) => {
    const a = metrics.get(left);
    const b = metrics.get(right);
    if (group.id === 'dofus' && b.prysmaradite !== a.prysmaradite) return b.prysmaradite - a.prysmaradite;
    return b.deficit - a.deficit
      || b.objectiveGain - a.objectiveGain
      || b.optimistic - a.optimistic
      || String(left.item.id).localeCompare(String(right.item.id));
  });
  const key = group.id === 'companion' ? 'topCompanionExplorationHints' : 'topDofusExplorationHints';
  if (debugHints && !debugHints[key]) {
    debugHints[key] = ordered.slice(0, DEBUG_HINT_LIMIT).map((profile) => ({
      id: String(profile.item.id),
      ...metrics.get(profile)
    }));
  }
  return ordered;
}
function insertTop(values, value, limit) {
  if (!(value > 0) || limit <= 0) return values;
  const next = [...values, value].sort((a, b) => b - a);
  if (next.length > limit) next.length = limit;
  return next;
}
function buildSuffixCaps(profiles = [], keys = [], maxPicks = 0) {
  const n = profiles.length;
  const table = Array.from({ length: n + 1 }, () => Array(Math.max(0, maxPicks) + 1));
  const topByKey = Object.fromEntries(keys.map((key) => [key, []]));
  let unbounded = 0;
  function snapshot(start) {
    for (let count = 0; count <= maxPicks; count++) {
      const caps = Object.fromEntries(keys.map((key) => [key, 0]));
      for (const key of keys) {
        const values = topByKey[key] || [];
        for (let index = 0; index < count; index++) caps[key] += Number(values[index] || 0);
      }
      table[start][count] = {
        caps,
        bounded: count === 0 ? true : unbounded === 0,
        impossibleShape: n - start < count
      };
    }
  }
  snapshot(n);
  for (let start = n - 1; start >= 0; start--) {
    const profile = profiles[start];
    if (profile?.bounded === false) unbounded++;
    for (const key of keys) {
      const value = Math.max(0, positiveConstraintContribution(profile?.optimisticStats || {}, key));
      topByKey[key] = insertTop(topByKey[key], value, maxPicks);
    }
    snapshot(start);
  }
  return {
    get(startIndex, picks) {
      const start = Math.max(0, Math.min(n, Number(startIndex || 0)));
      const count = Math.max(0, Math.min(maxPicks, Number(picks || 0)));
      return table[start][count];
    }
  };
}
function combineProfileCaps(remaining = [], keys = []) {
  const caps = Object.fromEntries(keys.map((key) => [key, 0]));
  let bounded = true;
  let impossibleShape = false;
  for (const group of remaining) {
    const profileCaps = group.profileCaps;
    if (!profileCaps) continue;
    bounded = bounded && profileCaps.bounded !== false;
    impossibleShape = impossibleShape || profileCaps.impossibleShape === true;
    for (const key of keys) caps[key] += Number(profileCaps.caps?.[key] || 0);
  }
  return { caps, bounded, impossibleShape };
}

export function searchConstraintCompletenessRescue({
  items = [],
  sets = [],
  selections = [],
  constraints = {},
  fmPolicy = {},
  turnMode = 'sum',
  scenario = {},
  requiredItemIds = [],
  rejectedItemIds = [],
  searchProfile = 'BALANCED',
  scoreValidBuild = null,
  useOffensiveBound = true,
  onProgress = null,
  explorationGuidance = 'guided',
  debugExplorationHints = false
} = {}) {
  const startedAt = clockMs();
  if (!positiveConstraintKeys(constraints).length) {
    return { results: [], candidateItems: [], diagnostics: inactiveDiagnostics() };
  }
  const rejected = new Set(normalizeIds(rejectedItemIds));
  const optimizerEligible = filterOptimizerEligibleItems(items);
  const required = requiredState(optimizerEligible, requiredItemIds, rejectedItemIds);
  const eligibleItems = optimizerEligible.filter((item) => !rejected.has(String(item.id)));
  const pruneReasons = new Map();
  const constraintKeys = positiveConstraintKeys(constraints);
  const noCrit = noCritExplorationContext(scenario);
  const guidedT1 = turnMode === 't1' && explorationGuidance !== 'legacy';
  const debugHints = debugExplorationHints ? {} : null;
  let nodes = 1;
  let leaves = 0;
  let pruned = 0;
  let evaluated = 0;
  let valid = 0;
  let incumbent = null;
  let firstIncumbentAtNode = null;
  let orderedGroups = [];

  function finish(reason = null) {
    return {
      results: incumbent ? [incumbent] : [],
      candidateItems: eligibleItems,
      diagnostics: makeDiagnostics({
        used: true,
        nodes,
        leaves,
        pruned,
        evaluated,
        valid,
        exhausted: true,
        eligibleItems: eligibleItems.length,
        pruneReasons,
        groupOrder: orderedGroups.map((group) => group.id),
        firstIncumbentAtNode,
        startedAt,
        reason,
        debugHints
      })
    };
  }
  if (!required.valid) {
    addCount(pruneReasons, required.reason || 'required-invalid');
    pruned++;
    return finish(required.reason || 'required-invalid');
  }

  const requiredIds = new Set(required.requiredIds);
  const counts = new Map();
  for (const item of required.items) counts.set(item.slot, (counts.get(item.slot) || 0) + 1);
  const policy = createCandidatePolicy({ items: eligibleItems, sets, selections, constraints, turnMode, scenario, searchProfile, slotRules: SLOT_RULES });
  const setExploration = rankSetExploration(policy, constraints, noCrit);
  if (debugHints) {
    debugHints.topSetExplorationHints = setExploration.ranked.slice(0, DEBUG_HINT_LIMIT).map((core) => ({
      coreId: core.id,
      setId: core.setId,
      name: core.setName,
      pieceCount: core.pieceCount,
      score: core.explorationOffense,
      constraint: core.explorationConstraint,
      memberIds: [...(core.itemIds || [])]
    }));
    debugHints.noCritExplorationHintSupported = noCrit;
  }
  const allProfilesBySlot = new Map();
  for (const rule of SLOT_RULES) {
    const profiles = eligibleItems.filter((item) => item.slot === rule.id).map((item) => policy.profileItem(item));
    allProfilesBySlot.set(rule.id, profiles);
  }
  const profilesFor = (slot) => allProfilesBySlot.get(slot) || [];
  const setsById = Object.fromEntries((sets || []).map((set) => [set.id, set]));
  const groups = [];
  for (const rule of SLOT_RULES) {
    const missing = Number(rule.count || 0) - Number(counts.get(rule.id) || 0);
    if (missing <= 0) continue;
    const available = profilesFor(rule.id).filter((profile) => !requiredIds.has(String(profile.item.id)));
    if (available.length < missing) {
      addCount(pruneReasons, 'impossible-build-shape');
      pruned++;
      return finish('impossible-build-shape');
    }
    const profiles = guidedT1 && EQUIPMENT_SLOTS.has(rule.id)
      ? sortEquipmentProfiles(available, constraints, setExploration.byItem)
      : sortProfilesForExploration(available, constraints);
    const suffix = buildSuffixCaps(profiles, constraintKeys, missing);
    groups.push({ id: rule.id, missing, profiles, fullProfileCaps: suffix.get(0, missing) });
  }
  orderedGroups = guidedT1
    ? sortGroupsGuidedT1(groups, constraints, setExploration.byItem)
    : sortGroupsLegacy(groups, constraints);
  const selectedItems = [...required.items];
  const selectedIds = new Set(required.items.map((item) => String(item.id)));
  const optimisticItemCache = new Map();
  const setEnvelope = createBranchFeasibilityEnvelope({ remainingGroups: [], profilesFor, constraints, sets });

  function progress(label = 'rescue contraintes') {
    if (!onProgress) return;
    onProgress({ phase: 'constraint-rescue', label, nodes, visited: valid, pruned, best: incumbent?.score || 0, partialResults: incumbent ? [incumbent] : null });
  }
  function initialRemaining() {
    return orderedGroups.map((group) => ({
      id: group.id,
      missing: group.missing,
      profileCaps: group.fullProfileCaps,
      availableProfiles: group.profiles
    }));
  }
  function remainingGroups(groupIndex, picksLeftInCurrent = 0, currentProfiles = null, suffixCaps = null, nextStartIndex = 0) {
    const remaining = [];
    if (picksLeftInCurrent > 0) {
      remaining.push({
        id: orderedGroups[groupIndex].id,
        missing: picksLeftInCurrent,
        profileCaps: suffixCaps.get(nextStartIndex, picksLeftInCurrent),
        availableProfiles: currentProfiles.slice(nextStartIndex)
      });
    }
    for (let index = groupIndex + 1; index < orderedGroups.length; index++) {
      remaining.push({
        id: orderedGroups[index].id,
        missing: orderedGroups[index].missing,
        profileCaps: orderedGroups[index].fullProfileCaps,
        availableProfiles: orderedGroups[index].profiles
      });
    }
    return remaining;
  }
  function safelyPossible(remaining, reasonPrefix = 'constraint') {
    const envelope = {
      keys: constraintKeys,
      remaining: combineProfileCaps(remaining, constraintKeys),
      setCaps: setEnvelope.setCaps || {}
    };
    const feasibility = branchFeasibility({
      items: selectedItems,
      remainingGroups: remaining,
      profilesFor,
      constraints,
      fmPolicy,
      sets,
      setsById,
      envelope
    });
    if (!feasibility.feasible) {
      addCount(pruneReasons, feasibility.key === 'shape' ? 'impossible-build-shape' : `${reasonPrefix}:${feasibility.key}`);
      pruned++;
      return false;
    }
    if (incumbent && useOffensiveBound) {
      const remainingProfilesBySlot = new Map(remaining.map((group) => [group.id, group.availableProfiles || profilesFor(group.id)]));
      const bound = offensiveUpperBound({
        items: selectedItems,
        remainingGroups: remaining,
        profilesFor: (slot) => remainingProfilesBySlot.get(slot) || [],
        policy,
        sets,
        fmPolicy,
        optimisticItemCache
      });
      if (Number.isFinite(bound) && bound + SCORE_EPSILON < Number(incumbent.score || 0)) {
        addCount(pruneReasons, 'offensive-upper-bound');
        pruned++;
        return false;
      }
    }
    return true;
  }
  function evaluateLeaf() {
    leaves++;
    const evaluation = evaluateCompleteBuild({
      items: selectedItems,
      sets,
      selections,
      constraints,
      fmPolicy: { ...fmPolicy, structuralExos: false },
      turnMode,
      scenario: { ...(scenario || {}) }
    });
    evaluated++;
    if (!evaluation.result) return;
    const candidate = typeof scoreValidBuild === 'function' ? scoreValidBuild(evaluation.result) : evaluation.result;
    if (!candidate) return;
    valid++;
    if (firstIncumbentAtNode === null) firstIncumbentAtNode = nodes;
    if (!incumbent
      || Number(candidate.score || 0) > Number(incumbent.score || 0) + SCORE_EPSILON
      || (Math.abs(Number(candidate.score || 0) - Number(incumbent.score || 0)) <= SCORE_EPSILON
        && resultKey(candidate).localeCompare(resultKey(incumbent)) < 0)) {
      incumbent = candidate;
      progress('rescue contraintes · incumbent valide');
    }
  }
  function visitGroup(groupIndex) {
    if (groupIndex >= orderedGroups.length) {
      evaluateLeaf();
      return;
    }
    const group = orderedGroups[groupIndex];
    const profiles = guidedT1
      ? dynamicProfilesForGroup(group, selectedItems, setsById, policy, constraints, noCrit, debugHints)
      : group.profiles;
    const suffixCaps = buildSuffixCaps(profiles, constraintKeys, group.missing);
    function choose(startIndex, picksLeft) {
      if (picksLeft === 0) {
        visitGroup(groupIndex + 1);
        return;
      }
      const lastStart = profiles.length - picksLeft;
      if (startIndex > lastStart) {
        addCount(pruneReasons, 'impossible-build-shape');
        pruned++;
        return;
      }
      for (let index = startIndex; index <= lastStart; index++) {
        const item = profiles[index].item;
        const id = String(item.id);
        if (selectedIds.has(id)) continue;
        nodes++;
        selectedItems.push(item);
        selectedIds.add(id);
        let keep = true;
        if (!specialSlotRulesAreValid(selectedItems)) {
          addCount(pruneReasons, 'special-slot-rule');
          pruned++;
          keep = false;
        }
        const left = picksLeft - 1;
        if (keep) keep = safelyPossible(remainingGroups(groupIndex, left, profiles, suffixCaps, index + 1));
        if (keep) choose(index + 1, left);
        selectedIds.delete(id);
        selectedItems.pop();
        if (nodes % PROGRESS_NODE_INTERVAL === 0) progress();
      }
    }
    choose(0, group.missing);
  }

  if (!safelyPossible(initialRemaining())) return finish('constraints-impossible-by-upper-envelope');
  visitGroup(0);
  progress(incumbent ? 'rescue contraintes · terminé' : 'rescue contraintes · impossible');
  return finish(incumbent ? 'feasible' : 'exhaustively-impossible');
}
