import { SLOT_RULES } from './config.js';
import { specialSlotRulesAreValid } from './build-legality.js';
import { evaluateCompleteBuild } from './complete-build-evaluator.js';
import { positiveConstraintContribution } from './stats.js';
import { branchFeasibility, offensiveUpperBound } from '../optimizer/candidate-search.js';
import { createCandidatePolicy, positiveConstraintKeys } from '../optimizer/candidate-policy.js';
import { filterOptimizerEligibleItems } from '../optimizer/item-eligibility.js';

const STRUCTURAL_CONSTRAINT_KEYS = new Set(['ap', 'mp', 'range']);
const PROGRESS_NODE_INTERVAL = 4096;
const SCORE_EPSILON = 1e-9;

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
    constraintRescueNodes: 0,
    constraintRescuePruned: 0,
    constraintRescueEvaluated: 0,
    constraintRescueValid: 0,
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
function sortGroupsForExploration(groups = [], constraints = {}) {
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
function makeDiagnostics({ used, nodes, pruned, evaluated, valid, exhausted, eligibleItems, pruneReasons, reason = null }) {
  return {
    constraintRescueUsed: Boolean(used),
    constraintRescueNodes: Number(nodes || 0),
    constraintRescuePruned: Number(pruned || 0),
    constraintRescueEvaluated: Number(evaluated || 0),
    constraintRescueValid: Number(valid || 0),
    constraintRescueExhausted: Boolean(exhausted),
    constraintRescueEligibleItems: Number(eligibleItems || 0),
    constraintRescueReason: reason,
    constraintRescuePruneReasons: Object.fromEntries(pruneReasons || [])
  };
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
  onProgress = null
} = {}) {
  if (!positiveConstraintKeys(constraints).length) {
    return { results: [], candidateItems: [], diagnostics: inactiveDiagnostics() };
  }
  const rejected = new Set(normalizeIds(rejectedItemIds));
  const optimizerEligible = filterOptimizerEligibleItems(items);
  const required = requiredState(optimizerEligible, requiredItemIds, rejectedItemIds);
  const eligibleItems = optimizerEligible.filter((item) => !rejected.has(String(item.id)));
  const pruneReasons = new Map();
  let nodes = 1;
  let pruned = 0;
  let evaluated = 0;
  let valid = 0;
  let incumbent = null;

  function finish(reason = null) {
    return {
      results: incumbent ? [incumbent] : [],
      candidateItems: eligibleItems,
      diagnostics: makeDiagnostics({ used: true, nodes, pruned, evaluated, valid, exhausted: true, eligibleItems: eligibleItems.length, pruneReasons, reason })
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
    groups.push({ id: rule.id, missing, profiles: sortProfilesForExploration(available, constraints) });
  }
  const orderedGroups = sortGroupsForExploration(groups, constraints);
  const selectedItems = [...required.items];
  const selectedIds = new Set(required.items.map((item) => String(item.id)));
  const optimisticItemCache = new Map();

  function progress(label = 'rescue contraintes') {
    if (!onProgress) return;
    onProgress({ phase: 'constraint-rescue', label, nodes, visited: valid, pruned, best: incumbent?.score || 0, partialResults: incumbent ? [incumbent] : null });
  }
  function remainingGroups(groupIndex, picksLeftInCurrent = 0) {
    const remaining = [];
    if (picksLeftInCurrent > 0) remaining.push({ id: orderedGroups[groupIndex].id, missing: picksLeftInCurrent });
    for (let index = groupIndex + 1; index < orderedGroups.length; index++) {
      remaining.push({ id: orderedGroups[index].id, missing: orderedGroups[index].missing });
    }
    return remaining;
  }
  function safelyPossible(remaining, reasonPrefix = 'constraint') {
    const feasibility = branchFeasibility({ items: selectedItems, remainingGroups: remaining, profilesFor, constraints, fmPolicy, sets, setsById });
    if (!feasibility.feasible) {
      addCount(pruneReasons, feasibility.key === 'shape' ? 'impossible-build-shape' : `${reasonPrefix}:${feasibility.key}`);
      pruned++;
      return false;
    }
    if (incumbent && useOffensiveBound) {
      const bound = offensiveUpperBound({ items: selectedItems, remainingGroups: remaining, profilesFor, policy, sets, fmPolicy, optimisticItemCache });
      if (Number.isFinite(bound) && bound + SCORE_EPSILON < Number(incumbent.score || 0)) {
        addCount(pruneReasons, 'offensive-upper-bound');
        pruned++;
        return false;
      }
    }
    return true;
  }
  function evaluateLeaf() {
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
    function choose(startIndex, picksLeft) {
      if (picksLeft === 0) {
        visitGroup(groupIndex + 1);
        return;
      }
      const lastStart = group.profiles.length - picksLeft;
      if (startIndex > lastStart) {
        addCount(pruneReasons, 'impossible-build-shape');
        pruned++;
        return;
      }
      for (let index = startIndex; index <= lastStart; index++) {
        const item = group.profiles[index].item;
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
        if (keep) keep = safelyPossible(remainingGroups(groupIndex, left));
        if (keep) choose(index + 1, left);
        selectedIds.delete(id);
        selectedItems.pop();
        if (nodes % PROGRESS_NODE_INTERVAL === 0) progress();
      }
    }
    choose(0, group.missing);
  }

  const initialRemaining = orderedGroups.map((group) => ({ id: group.id, missing: group.missing }));
  if (!safelyPossible(initialRemaining)) return finish('constraints-impossible-by-upper-envelope');
  visitGroup(0);
  progress(incumbent ? 'rescue contraintes · terminé' : 'rescue contraintes · impossible');
  return finish(incumbent ? 'feasible' : 'exhaustively-impossible');
}
