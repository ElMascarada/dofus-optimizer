import { SLOT_RULES } from './config.js';
import { evaluateCompleteBuild } from './complete-build-evaluator.js';
import { branchFeasibility, createBranchFeasibilityEnvelope } from '../optimizer/candidate-search.js';
import { createCandidatePolicy, positiveConstraintKeys } from '../optimizer/candidate-policy.js';
import { filterOptimizerEligibleItems } from '../optimizer/item-eligibility.js';
import {
  COMBAT_T1_BOUND_STAT_KEYS,
  combatT1UpperBound,
  createCombatT1UpperBoundContext
} from './combat-t1-upper-bound.js';
import {
  addCount,
  buildSuffixCaps,
  combineProfileCaps,
  requiredState,
  setExplorationHints,
  sortEquipmentProfiles,
  sortGroups,
  sortGroupsCombat
} from './constraint-completeness-combat-helpers.js';
import { runExactCombatGroupDfs } from './constraint-completeness-combat-dfs.js';
import { createEquipmentParetoReducer } from './equipment-slot-footprint-pareto.js';

const EQUIPMENT_SLOTS = new Set(['hat', 'cape', 'amulet', 'belt', 'boots', 'weapon', 'ring', 'shield']);
const SCORE_EPSILON = 1e-9;
const PROGRESS_NODE_INTERVAL = 4096;
const DEBUG_HINT_LIMIT = 8;

function emptyEquipmentParetoDiagnostics() {
  return {
    constraintRescueEquipmentStructures: 0,
    constraintRescueParetoComparable: 0,
    constraintRescueParetoDominated: 0,
    constraintRescueParetoFrontier: 0,
    constraintRescueParetoOpaqueKept: 0
  };
}

function clockMs() {
  return typeof globalThis.performance?.now === 'function' ? globalThis.performance.now() : Date.now();
}
function resultKey(result) {
  return (result?.items || []).map((item) => String(item.id)).sort().join('|');
}
function normalizeIds(values = []) {
  return [...new Set((values || []).map(String).filter(Boolean))];
}
function noCritExplorationContext(scenario = {}) {
  return scenario?.noCrit === true
    || String(scenario?.critMode || '').toLowerCase() === 'no-crit'
    || String(scenario?.criticalMode || '').toLowerCase() === 'no-crit';
}
function makeDiagnostics({ nodes, leaves, pruned, evaluated, valid, eligibleItems, pruneReasons, orderedGroups,
  firstIncumbentAtNode, firstIncumbentScore, incumbent, combatBoundCalls, combatBoundPruned, startedAt, reason,
  debugHints, equipmentParetoDiagnostics, companionExpansions, dofusExpansions }) {
  return {
    constraintRescueUsed: true,
    constraintRescueGroupOrder: orderedGroups.map((group) => group.id),
    constraintRescueFirstIncumbentAtNode: firstIncumbentAtNode,
    constraintRescueFirstIncumbentScore: firstIncumbentScore,
    constraintRescueFinalIncumbentScore: incumbent ? Number(incumbent.score || 0) : null,
    constraintRescueCombatBoundCalls: combatBoundCalls,
    constraintRescueCombatBoundPruned: combatBoundPruned,
    constraintRescueNodes: nodes,
    constraintRescueLeaves: leaves,
    constraintRescuePruned: pruned,
    constraintRescueEvaluated: evaluated,
    constraintRescueValid: valid,
    constraintRescueElapsedMs: Math.round(Math.max(0, clockMs() - startedAt) * 1000) / 1000,
    constraintRescueExhausted: true,
    constraintRescueEligibleItems: eligibleItems,
    constraintRescueReason: reason,
    constraintRescuePruneReasons: Object.fromEntries(pruneReasons),
    ...equipmentParetoDiagnostics,
    constraintRescueCompanionExpansions: companionExpansions,
    constraintRescueDofusExpansions: dofusExpansions,
    ...(debugHints || {})
  };
}

export function searchCombatT1ConstraintRescue({
  items = [], sets = [], selections = [], constraints = {}, fmPolicy = {}, turnMode = 't1', scenario = {},
  requiredItemIds = [], rejectedItemIds = [], searchProfile = 'BALANCED', scoreValidBuild = null,
  classSpells = [], combatObjective = {}, objectiveMode = null, onProgress = null,
  debugExplorationHints = false, equipmentParetoEnabled = true
} = {}) {
  const startedAt = clockMs();
  const pruneReasons = new Map();
  const rejected = new Set(normalizeIds(rejectedItemIds));
  const optimizerEligible = filterOptimizerEligibleItems(items);
  const eligibleItems = optimizerEligible.filter((item) => !rejected.has(String(item.id)));
  const required = requiredState(optimizerEligible, requiredItemIds, rejectedItemIds);
  const constraintKeys = positiveConstraintKeys(constraints);
  const combatBoundEnabled = objectiveMode === 'combat'
    && typeof scoreValidBuild === 'function'
    && Array.isArray(classSpells)
    && classSpells.length > 0;
  const suffixKeys = combatBoundEnabled
    ? [...new Set([...constraintKeys, ...COMBAT_T1_BOUND_STAT_KEYS])]
    : constraintKeys;
  const debugHints = debugExplorationHints ? {} : null;
  let nodes = 1, leaves = 0, pruned = 0, evaluated = 0, valid = 0;
  let incumbent = null, firstIncumbentAtNode = null, firstIncumbentScore = null;
  let combatBoundCalls = 0, combatBoundPruned = 0, orderedGroups = [];
  let equipmentParetoDiagnostics = emptyEquipmentParetoDiagnostics();
  let companionExpansions = 0, dofusExpansions = 0;

  function finish(reason) {
    return {
      results: incumbent ? [incumbent] : [], candidateItems: eligibleItems,
      diagnostics: makeDiagnostics({
        nodes, leaves, pruned, evaluated, valid, eligibleItems: eligibleItems.length, pruneReasons, orderedGroups,
        firstIncumbentAtNode, firstIncumbentScore, incumbent, combatBoundCalls, combatBoundPruned, startedAt, reason,
        debugHints, equipmentParetoDiagnostics, companionExpansions, dofusExpansions
      })
    };
  }
  if (!constraintKeys.length) return finish('no-active-constraint');
  if (!required.valid) {
    addCount(pruneReasons, required.reason || 'required-invalid');
    pruned++;
    return finish(required.reason || 'required-invalid');
  }

  const requiredIds = new Set(required.requiredIds);
  const counts = new Map();
  for (const item of required.items) counts.set(item.slot, (counts.get(item.slot) || 0) + 1);
  const policy = createCandidatePolicy({
    items: eligibleItems, sets, selections, constraints, turnMode, scenario, searchProfile, slotRules: SLOT_RULES
  });
  const noCrit = noCritExplorationContext(scenario);
  const setExploration = setExplorationHints(policy, constraints, noCrit);
  if (debugHints) {
    debugHints.topSetExplorationHints = setExploration.ranked.slice(0, DEBUG_HINT_LIMIT).map((core) => ({
      coreId: core.id,
      setId: core.setId,
      name: core.setName,
      pieceCount: core.pieceCount,
      score: core.explorationScore,
      constraint: core.explorationConstraint,
      memberIds: [...(core.itemIds || [])]
    }));
    debugHints.noCritExplorationHintSupported = noCrit;
  }
  const allProfilesBySlot = new Map();
  for (const rule of SLOT_RULES) {
    allProfilesBySlot.set(rule.id,
      eligibleItems.filter((item) => item.slot === rule.id).map((item) => policy.profileItem(item)));
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
    const profiles = EQUIPMENT_SLOTS.has(rule.id)
      ? sortEquipmentProfiles(available, constraints, setExploration.byItem)
      : [...available];
    const suffix = buildSuffixCaps(profiles, suffixKeys, missing);
    groups.push({ id: rule.id, missing, profiles, fullProfileCaps: suffix.get(0, missing) });
  }
  orderedGroups = combatBoundEnabled
    ? sortGroupsCombat(groups)
    : sortGroups(groups, constraints, setExploration.byItem);

  const selectedItems = [...required.items];
  const selectedIds = new Set(required.items.map((item) => String(item.id)));
  const optimisticItemCache = new Map();
  const setEnvelope = createBranchFeasibilityEnvelope({ remainingGroups: [], profilesFor, constraints, sets });
  const combatBoundContext = combatBoundEnabled
    ? createCombatT1UpperBoundContext({ classSpells, combatObjective, scenario, searchProfile, sets, fmPolicy })
    : null;
  const completionItems = orderedGroups
    .filter((group) => !EQUIPMENT_SLOTS.has(group.id))
    .flatMap((group) => group.profiles.map((profile) => profile.item));
  const equipmentPareto = combatBoundEnabled && equipmentParetoEnabled
    ? createEquipmentParetoReducer({
        requiredItemIds: required.requiredIds,
        completionItems,
        setsById,
        selections,
        constraints,
        scenario,
        fmPolicy
      })
    : null;

  function progress(label = 'rescue contraintes') {
    if (!onProgress) return;
    onProgress({ phase: 'constraint-rescue', label, nodes, visited: valid, pruned,
      best: incumbent?.score || 0, partialResults: incumbent ? [incumbent] : null });
  }
  function initialRemaining() {
    return orderedGroups.map((group) => ({
      id: group.id, missing: group.missing, profileCaps: group.fullProfileCaps, availableProfiles: group.profiles
    }));
  }
  function safelyPossible(remaining) {
    const envelope = {
      keys: constraintKeys,
      remaining: combineProfileCaps(remaining, constraintKeys),
      setCaps: setEnvelope.setCaps || {}
    };
    const feasibility = branchFeasibility({
      items: selectedItems, remainingGroups: remaining, profilesFor, constraints, fmPolicy, sets, setsById, envelope
    });
    if (!feasibility.feasible) {
      addCount(pruneReasons, feasibility.key === 'shape' ? 'impossible-build-shape' : `constraint:${feasibility.key}`);
      pruned++;
      return false;
    }
    if (combatBoundEnabled && incumbent) {
      combatBoundCalls++;
      const upperBound = combatT1UpperBound({
        items: selectedItems,
        remainingCaps: combineProfileCaps(remaining, COMBAT_T1_BOUND_STAT_KEYS),
        policy, context: combatBoundContext, optimisticItemCache
      });
      if (Number.isFinite(upperBound) && upperBound <= Number(incumbent.score || 0) + SCORE_EPSILON) {
        addCount(pruneReasons, 'combat-t1-upper-bound');
        combatBoundPruned++;
        pruned++;
        return false;
      }
    }
    return true;
  }
  function evaluateLeaf() {
    leaves++;
    const evaluation = evaluateCompleteBuild({
      items: selectedItems, sets, selections, constraints,
      fmPolicy: { ...fmPolicy, structuralExos: false }, turnMode, scenario: { ...(scenario || {}) }
    });
    evaluated++;
    if (!evaluation.result) return;
    const candidate = typeof scoreValidBuild === 'function' ? scoreValidBuild(evaluation.result) : evaluation.result;
    if (!candidate) return;
    valid++;
    if (firstIncumbentAtNode === null) {
      firstIncumbentAtNode = nodes;
      firstIncumbentScore = Number(candidate.score || 0);
    }
    if (!incumbent
      || Number(candidate.score || 0) > Number(incumbent.score || 0) + SCORE_EPSILON
      || (Math.abs(Number(candidate.score || 0) - Number(incumbent.score || 0)) <= SCORE_EPSILON
        && resultKey(candidate).localeCompare(resultKey(incumbent)) < 0)) {
      incumbent = candidate;
      progress('rescue contraintes · incumbent valide');
    }
  }
  function onPrune(reason) {
    addCount(pruneReasons, reason);
    pruned++;
  }
  function onNode() {
    nodes++;
    return nodes;
  }
  function onProgressNode(currentNodes) {
    if (currentNodes % PROGRESS_NODE_INTERVAL === 0) progress();
  }
  function onGroupExpansion(groupId) {
    if (groupId === 'companion') companionExpansions++;
    if (groupId === 'dofus') dofusExpansions++;
  }

  if (!safelyPossible(initialRemaining())) return finish('constraints-impossible-by-upper-envelope');
  runExactCombatGroupDfs({
    orderedGroups, selectedItems, selectedIds, setsById, policy, constraints, suffixKeys,
    safelyPossible, evaluateLeaf, onNode, onPrune, onProgressNode, debugHints,
    equipmentPareto, onGroupExpansion
  });
  if (equipmentPareto) {
    equipmentParetoDiagnostics = equipmentPareto.diagnostics();
    if (debugHints) debugHints.topEquipmentParetoStructures = equipmentPareto.debugTop(DEBUG_HINT_LIMIT);
  }
  progress(incumbent ? 'rescue contraintes · terminé' : 'rescue contraintes · impossible');
  return finish(incumbent ? 'feasible' : 'exhaustively-impossible');
}
