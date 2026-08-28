import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { BASE_CHARACTER, SLOT_RULES } from '../js/config.js';
import { createOptimizerV2Request } from '../js/optimizer-v2-orchestrator.js';
import { preferCompanionVitalityOnTies } from '../js/combat-feedback.js';
import { prefilterItems } from '../js/candidate-prefilter.js';
import { evaluateCompleteBuild } from '../js/complete-build-evaluator.js';
import { addStats, effectiveStat, emptyStats } from '../js/stats.js';
import { applySetBonuses } from '../js/sets.js';
import { estimateElementValues } from '../js/spells.js';
import { optimizeCharacteristics } from '../js/characteristics.js';
import { optimizeFm } from '../js/fm.js';
import {
  characteristicMinimumsForItems,
  countSetBonuses,
  evaluateNormalizedCondition,
  itemConditionsAreValid
} from '../js/build-legality.js';
import { buildGroupChoices } from '../optimizer/candidate-search.js';
import { getSearchProfile } from '../optimizer/search-profiles.js';
import { createInstrumentedArchitectureSearch } from './support/architecture-search-diagnostic-harness.mjs';

const IGNORED_COMPLEX_DOFUS_PASSIVES = [
  'deep-purple',
  'turquoise-blue',
  'vermilion-red',
  'yellow-ochre',
  'descent-to-abyss'
];

const dataset = JSON.parse(readFileSync(new URL('../data/normalized/dofus-data.json', import.meta.url), 'utf8'));
const spellData = JSON.parse(readFileSync(new URL('../data/normalized/spell-data.json', import.meta.url), 'utf8'));
const iop = (spellData.breeds || []).find((breed) => breed?.name === 'Iop');
assert.ok(iop, 'Iop must exist in canonical spell data');

const searchWithDiagnostics = await createInstrumentedArchitectureSearch();

function activeTurns(turnMode) {
  if (turnMode === 't1') return [1];
  if (turnMode === 't2') return [2];
  if (turnMode === 't3') return [3];
  return [1, 2, 3];
}

function selectionsForTurnMode(selections = [], turnMode = 'sum') {
  const allowed = new Set(activeTurns(turnMode));
  return (selections || []).map((selection) => ({
    ...selection,
    casts: {
      1: allowed.has(1) ? Number(selection.casts?.[1] || 0) : 0,
      2: allowed.has(2) ? Number(selection.casts?.[2] || 0) : 0,
      3: allowed.has(3) ? Number(selection.casts?.[3] || 0) : 0
    }
  }));
}

function spellMatchesElement(spell, element = 'multi') {
  if (element === 'multi' || !element) return Array.isArray(spell?.hits) && spell.hits.length > 0;
  return (spell?.hits || []).some((hit) => hit?.element === element);
}

function combatGearSelections(classSpells = [], combatObjective = {}) {
  const turns = new Set(activeTurns(combatObjective.turnMode || 't1'));
  const element = combatObjective.element || 'multi';
  return (classSpells || [])
    .filter((spell) => spellMatchesElement(spell, element))
    .map((spell) => ({
      spell: { ...spell },
      enabled: true,
      weight: 1,
      casts: {
        1: turns.has(1) ? 1 : 0,
        2: turns.has(2) ? 1 : 0,
        3: turns.has(3) ? 1 : 0
      }
    }));
}

function scenarioForUi(scenario = {}, turnMode = 'sum') {
  const allowed = new Set(activeTurns(turnMode));
  const requiredApByTurn = {};
  for (const turn of [1, 2, 3]) {
    if (allowed.has(turn)) requiredApByTurn[turn] = Number(scenario?.requiredApByTurn?.[turn] || 0);
  }
  return {
    ...scenario,
    requiredApByTurn,
    ignoredPassiveIds: [
      ...new Set([...(scenario.ignoredPassiveIds || []), ...IGNORED_COMPLEX_DOFUS_PASSIVES])
    ]
  };
}

function capped(floor, multiplier, requestedTopN, ceiling = Infinity) {
  return Math.min(ceiling, Math.max(floor, requestedTopN * multiplier));
}

function iopEarthRequest() {
  return createOptimizerV2Request({
    dataset,
    spellData,
    classId: String(iop.id),
    element: 'earth',
    constraints: { ap: 12, mp: 6, initiative: 0 },
    turnMode: 't1',
    topN: 10
  });
}

function workerPrimaryPayload(request) {
  const combatMode = request?.objectiveMode === 'combat';
  const combatObjective = request?.combatObjective || {};
  const turnMode = combatMode
    ? (combatObjective.turnMode || request?.turnMode || 't1')
    : (request?.turnMode || 'sum');
  const rawSelections = combatMode
    ? combatGearSelections(request?.classSpells || [], combatObjective)
    : request?.selections;
  const selections = selectionsForTurnMode(rawSelections, turnMode);
  const scenario = scenarioForUi(request?.scenario, turnMode);
  const enabledSpellCount = selections.filter((selection) => selection.enabled).length;
  if (combatMode || enabledSpellCount <= 1) scenario.requiredApByTurn = {};

  const searchProfileName = String(request?.searchProfile || 'BALANCED').toUpperCase();
  const profile = getSearchProfile(searchProfileName);
  const budget = profile.worker;
  const requestedTopN = Math.max(1, Number(request?.topN || 10));
  const diversityMode = String(request?.diversityMode || 'gear');
  const diversifiedSearch = diversityMode !== 'score';
  const searchTopN = combatMode
    ? capped(
        diversifiedSearch ? budget.structureCombatDiversityFloor : budget.structureCombatScoreFloor,
        diversifiedSearch ? budget.structureCombatDiversityMultiplier : budget.structureCombatScoreMultiplier,
        requestedTopN
      )
    : diversifiedSearch
      ? capped(budget.structureNonCombatDiversityFloor, budget.structureNonCombatDiversityMultiplier, requestedTopN)
      : requestedTopN;

  return {
    profile,
    searchTopN,
    payload: {
      ...request,
      searchProfile: searchProfileName,
      requiredItemIds: [...new Set((request?.requiredItemIds || []).map(String).filter(Boolean))],
      items: preferCompanionVitalityOnTies(request?.items || []),
      selections,
      turnMode,
      scenario,
      fmPolicy: { ...request?.fmPolicy, structuralExos: false },
      topN: searchTopN
    }
  };
}

function buildKey(items = []) {
  return (items || []).map((item) => String(item.id)).sort().join('|');
}

function captureSearch(payload) {
  const evaluations = [];
  const completeKeys = new Set();
  const evaluationPoolKeys = new Set();
  const completeByEntry = [];
  const evaluationPoolByEntry = [];

  const output = searchWithDiagnostics(payload, {
    onEvaluation({ args, outcome }) {
      evaluations.push({ args, outcome });
    },
    onComplete({ entry, searchOrigin, complete }) {
      const keys = complete.map((state) => buildKey(state.items));
      for (const key of keys) completeKeys.add(key);
      completeByEntry.push({
        origin: searchOrigin,
        architecture: entry?.variant?.label || 'unknown',
        count: keys.length
      });
    },
    onEvaluationPool({ entry, searchOrigin, evaluationPool }) {
      const keys = evaluationPool.map((state) => buildKey(state.items));
      for (const key of keys) evaluationPoolKeys.add(key);
      evaluationPoolByEntry.push({
        origin: searchOrigin,
        architecture: entry?.variant?.label || 'unknown',
        count: keys.length
      });
    }
  });

  return {
    output,
    evaluations,
    completeKeys,
    evaluationPoolKeys,
    completeByEntry,
    evaluationPoolByEntry
  };
}

function evaluatorGateDiagnostic(args, outcome) {
  if (outcome?.reason !== 'item-condition') return null;
  const character = args?.character || BASE_CHARACTER;
  const items = args?.items || [];
  const sets = args?.sets || [];
  const constraints = args?.constraints || {};
  const selections = args?.selections || [];
  const setsById = Object.fromEntries(sets.map((set) => [set.id, set]));
  const rawStats = emptyStats();
  addStats(rawStats, character.baseStats || {});
  for (const item of items) addStats(rawStats, item.stats || {});

  const statsWithSets = { ...rawStats };
  applySetBonuses(statsWithSets, items, setsById);
  const conditionReference = { ...statsWithSets };
  for (const element of ['earth', 'fire', 'water', 'air']) {
    conditionReference[element] = Number(conditionReference[element] || 0) + Number(character.scrolled?.[element] || 0);
  }
  const minimumStats = characteristicMinimumsForItems(items, conditionReference, character.level);
  const charResult = optimizeCharacteristics(statsWithSets, {
    points: character.characteristicPoints,
    scrolled: character.scrolled,
    elementValues: estimateElementValues(selections, {}),
    minimumVitality: constraints.vit || 0,
    baseVitality: 0,
    minimumStats
  });

  if (!charResult.requirementsSatisfied) {
    return {
      gate: 'A',
      stats: charResult.stats,
      minimumStats,
      items,
      characterLevel: character.level
    };
  }

  const fm = optimizeFm({
    baseStats: charResult.stats,
    items,
    selections,
    turnMode: args?.turnMode,
    policy: args?.fmPolicy,
    scenario: args?.scenario
  });
  if (!fm) return { gate: 'unexpected-fm-null', items, characterLevel: character.level };
  if (!itemConditionsAreValid(items, fm.stats, character.level)) {
    return {
      gate: 'B',
      stats: fm.stats,
      minimumStats,
      items,
      characterLevel: character.level
    };
  }
  return { gate: 'unexpected', items, characterLevel: character.level };
}

function conditionText(node) {
  if (!node) return 'none';
  if (node.kind === 'relation') {
    return `${node.relation}(${(node.children || []).map(conditionText).join(',')})`;
  }
  return `${node.stat}:${node.operator}:${node.value}`;
}

function failingLeaves(node, stats = {}, path = 'root') {
  if (!node || evaluateNormalizedCondition(node, stats)) return [];
  if (node.kind === 'relation') {
    return (node.children || []).flatMap((child, index) => failingLeaves(child, stats, `${path}.${node.relation}[${index}]`));
  }
  return [{
    path,
    stat: node.stat,
    operator: node.operator,
    required: Number(node.value),
    available: Number(effectiveStat(stats, node.stat))
  }];
}

function addAvailable(row, value) {
  const key = String(value);
  row.availableCounts.set(key, (row.availableCounts.get(key) || 0) + 1);
  row.availableMin = Math.min(row.availableMin, value);
  row.availableMax = Math.max(row.availableMax, value);
}

function summarizeConditionFailures(evaluations) {
  const gates = { A: 0, B: 0, unexpected: 0 };
  const failures = new Map();
  const pairCounts = new Map();
  const failedItemCountDistribution = new Map();
  const conditionalItemCountDistribution = new Map();

  for (const { args, outcome } of evaluations) {
    if (outcome?.reason !== 'item-condition') continue;
    const diagnostic = evaluatorGateDiagnostic(args, outcome);
    const gate = diagnostic?.gate === 'A' || diagnostic?.gate === 'B' ? diagnostic.gate : 'unexpected';
    gates[gate]++;

    const conditionStats = {
      ...(diagnostic?.stats || {}),
      level: Number(diagnostic?.characterLevel || 0),
      setBonus: countSetBonuses(diagnostic?.items || [])
    };
    const conditionalItems = (diagnostic?.items || []).filter((item) => item?.conditions);
    conditionalItemCountDistribution.set(
      conditionalItems.length,
      (conditionalItemCountDistribution.get(conditionalItems.length) || 0) + 1
    );

    const failedItems = [];
    const seenRows = new Set();
    for (const item of conditionalItems) {
      if (evaluateNormalizedCondition(item.conditions, conditionStats)) continue;
      failedItems.push(item);
      const normalized = conditionText(item.conditions);
      for (const leaf of failingLeaves(item.conditions, conditionStats)) {
        const key = [gate, item.id, normalized, leaf.stat, leaf.operator, leaf.required].join('|');
        if (seenRows.has(key)) continue;
        seenRows.add(key);
        if (!failures.has(key)) {
          failures.set(key, {
            gate,
            itemId: String(item.id),
            itemName: item.name,
            conditionNormalized: normalized,
            stat: leaf.stat,
            operator: leaf.operator,
            required: leaf.required,
            count: 0,
            availableMin: Infinity,
            availableMax: -Infinity,
            availableCounts: new Map()
          });
        }
        const row = failures.get(key);
        row.count++;
        addAvailable(row, leaf.available);
      }
    }

    failedItemCountDistribution.set(
      failedItems.length,
      (failedItemCountDistribution.get(failedItems.length) || 0) + 1
    );
    const names = [...new Set(failedItems.map((item) => `${item.id}:${item.name}`))].sort();
    for (let left = 0; left < names.length; left++) {
      for (let right = left + 1; right < names.length; right++) {
        const pair = `${names[left]} + ${names[right]}`;
        pairCounts.set(pair, (pairCounts.get(pair) || 0) + 1);
      }
    }
  }

  const top = [...failures.values()]
    .map((row) => {
      const available = [...row.availableCounts.entries()]
        .map(([value, count]) => ({ value: Number(value), count }))
        .sort((a, b) => b.count - a.count || a.value - b.value);
      return {
        gate: row.gate,
        itemId: row.itemId,
        itemName: row.itemName,
        conditionNormalized: row.conditionNormalized,
        stat: row.stat,
        operator: row.operator,
        required: row.required,
        available: row.availableMin === row.availableMax
          ? row.availableMin
          : { min: row.availableMin, max: row.availableMax, mostCommon: available.slice(0, 4) },
        count: row.count
      };
    })
    .sort((a, b) => b.count - a.count || a.itemName.localeCompare(b.itemName))
    .slice(0, 20);

  const topPairs = [...pairCounts.entries()]
    .map(([pair, count]) => ({ pair, count }))
    .sort((a, b) => b.count - a.count || a.pair.localeCompare(b.pair))
    .slice(0, 10);

  return {
    gates,
    top,
    failedItemCountDistribution: Object.fromEntries([...failedItemCountDistribution.entries()].sort((a, b) => a[0] - b[0])),
    conditionalItemCountDistribution: Object.fromEntries([...conditionalItemCountDistribution.entries()].sort((a, b) => a[0] - b[0])),
    topCoFailurePairs: topPairs
  };
}

function countBySlot(items = [], predicate = () => true) {
  const counts = {};
  for (const item of items || []) {
    if (!predicate(item)) continue;
    counts[item.slot] = (counts[item.slot] || 0) + 1;
  }
  return counts;
}

function candidatePoolSummary(pools = {}) {
  return Object.fromEntries(Object.entries(pools || {}).map(([slot, items]) => [slot, {
    count: (items || []).length,
    conditional: (items || []).filter((item) => item?.conditions).length
  }]));
}

function searchProfileSummary(inputItems, output) {
  const diagnostics = output?.diagnostics || {};
  return {
    inputItems: inputItems.length,
    inputConditionalItems: inputItems.filter((item) => item?.conditions).length,
    inputItemsBySlot: countBySlot(inputItems),
    inputConditionalBySlot: countBySlot(inputItems, (item) => Boolean(item?.conditions)),
    candidateItems: (output?.candidateItems || []).length,
    candidatePools: candidatePoolSummary(output?.candidatePools),
    architectures: Number(diagnostics.architectures || 0),
    architectureVariants: Number(diagnostics.architectureVariants || 0),
    expandedStates: Number(diagnostics.expandedStates || 0),
    heuristicTrimmed: Number(diagnostics.heuristicTrimmed || 0),
    legalCandidates: Number(diagnostics.legalCandidates || 0),
    evaluated: Number(diagnostics.evaluated || 0),
    valid: Number(diagnostics.valid || 0),
    rejected: diagnostics.rejected || {}
  };
}

function itemPresenceForBuild(build, candidatePools = {}) {
  return (build?.items || []).map((item) => ({
    slot: item.slot,
    itemId: String(item.id),
    itemName: item.name,
    present: (candidatePools?.[item.slot] || []).some((candidate) => String(candidate.id) === String(item.id))
  }));
}

function exactChoiceExists(choices, targetItems) {
  const target = buildKey(targetItems);
  return choices.some((choice) => buildKey(choice.items) === target);
}

function groupChoicesForBuild(build, payload) {
  const profile = getSearchProfile(payload.searchProfile);
  const prefilter = prefilterItems({
    items: payload.items,
    sets: payload.sets,
    selections: payload.selections,
    constraints: payload.constraints,
    turnMode: payload.turnMode,
    scenario: payload.scenario,
    requiredItemIds: payload.requiredItemIds || [],
    searchProfile: profile
  });
  const policy = prefilter.policy;
  const setsById = Object.fromEntries((payload.sets || []).map((set) => [set.id, set]));
  const context = {
    policy,
    profile,
    selections: payload.selections,
    constraints: payload.constraints,
    turnMode: payload.turnMode,
    scenario: payload.scenario,
    sets: payload.sets,
    setsById
  };

  return SLOT_RULES.map((rule) => {
    const targetItems = (build?.items || []).filter((item) => item.slot === rule.id);
    const profiles = (prefilter.pools?.[rule.id] || [])
      .map((item) => policy.profileItem(item))
      .sort((a, b) => b.rankScore - a.rankScore || String(a.item.id).localeCompare(String(b.item.id)));
    const choices = buildGroupChoices(profiles, Number(rule.count || 0), { ...context, slot: rule.id });
    return {
      slot: rule.id,
      requiredCount: Number(rule.count || 0),
      choices: choices.length,
      targetItemIds: targetItems.map((item) => String(item.id)).sort(),
      targetItemNames: targetItems.map((item) => item.name).sort(),
      exactChoiceAvailable: targetItems.length === Number(rule.count || 0) && exactChoiceExists(choices, targetItems)
    };
  });
}

function directEvaluation(build, payload) {
  return evaluateCompleteBuild({
    items: build.items,
    sets: payload.sets,
    selections: payload.selections,
    constraints: payload.constraints,
    fmPolicy: payload.fmPolicy,
    turnMode: payload.turnMode,
    scenario: payload.scenario
  });
}

function firstRouteLoss({ presence, groupChoices, completeKeys, evaluationPoolKeys, build }) {
  if (presence.some((entry) => !entry.present)) return 'A CandidatePrefilter';
  if (groupChoices.some((entry) => !entry.exactChoiceAvailable)) return 'B buildGroupChoices';
  const key = buildKey(build.items);
  if (!completeKeys.has(key)) return 'C state composition / beam';
  if (!evaluationPoolKeys.has(key)) return 'D evaluationPool';
  return 'reached CompleteBuildEvaluator';
}

test('canonical primary Search exposes the exact item-condition failure gates and fallback route loss', (t) => {
  const request = iopEarthRequest();
  const { payload, searchTopN } = workerPrimaryPayload(request);

  const primaryCapture = captureSearch(payload);
  const primary = primaryCapture.output;
  const primaryDiagnostics = primary.diagnostics || {};
  const conditionlessItems = payload.items.filter((item) => !item.conditions);
  const fallbackCapture = captureSearch({ ...payload, items: conditionlessItems });
  const fallback = fallbackCapture.output;

  const certified = {
    legalCandidates: Number(primaryDiagnostics.legalCandidates || 0),
    evaluated: Number(primaryDiagnostics.evaluated || 0),
    valid: Number(primaryDiagnostics.valid || 0),
    rejectedItemCondition: Number(primaryDiagnostics.rejected?.['item-condition'] || 0),
    fallbackEvaluated: Number(fallback.diagnostics?.evaluated || 0),
    fallbackValid: Number(fallback.diagnostics?.valid || 0),
    fallbackResults: Number(fallback.results?.length || 0),
    searchTopN
  };

  const conditionSummary = summarizeConditionFailures(primaryCapture.evaluations);
  t.diagnostic(`PRIMARY_CONDITION_DIAGNOSTIC ${JSON.stringify({
    ...certified,
    gates: conditionSummary.gates,
    failedItemCountDistribution: conditionSummary.failedItemCountDistribution,
    conditionalItemCountDistribution: conditionSummary.conditionalItemCountDistribution
  })}`);
  t.diagnostic(`TOP_ITEM_CONDITION_FAILURES ${JSON.stringify({
    failures: conditionSummary.top,
    topCoFailurePairs: conditionSummary.topCoFailurePairs
  })}`);

  assert.equal(certified.legalCandidates, 2420);
  assert.equal(certified.evaluated, 704);
  assert.equal(certified.valid, 0);
  assert.equal(certified.rejectedItemCondition, 704);
  assert.equal(certified.fallbackEvaluated, 704);
  assert.equal(certified.fallbackValid, 434);
  assert.equal(primaryCapture.evaluations.length, certified.evaluated);
  assert.equal(conditionSummary.gates.A + conditionSummary.gates.B, 704);
  assert.ok(fallback.results.length > 0, 'fallback must expose valid builds for route diagnosis');

  const fallbackBuilds = fallback.results.slice(0, 3).map((build, index) => {
    const evaluation = directEvaluation(build, payload);
    const presence = itemPresenceForBuild(build, primary.candidatePools);
    const groupChoices = groupChoicesForBuild(build, payload);
    const routeLoss = firstRouteLoss({
      presence,
      groupChoices,
      completeKeys: primaryCapture.completeKeys,
      evaluationPoolKeys: primaryCapture.evaluationPoolKeys,
      build
    });
    return {
      rank: index + 1,
      score: build.score,
      items: build.items.map((item) => ({ id: String(item.id), name: item.name, slot: item.slot })),
      evaluatorValid: Boolean(evaluation.result),
      evaluatorReason: evaluation.reason,
      allItemsInPrimaryPools: presence.every((entry) => entry.present),
      missingPrimaryPoolItems: presence.filter((entry) => !entry.present),
      groupChoices,
      exactCompleteStateSeen: primaryCapture.completeKeys.has(buildKey(build.items)),
      exactEvaluationPoolStateSeen: primaryCapture.evaluationPoolKeys.has(buildKey(build.items)),
      firstRouteLoss: routeLoss
    };
  });

  const best = fallback.results[0];
  const bestIds = best.items.map((item) => String(item.id));
  const anchoredCapture = captureSearch({
    ...payload,
    requiredItemIds: bestIds
  });
  const anchoredExact = anchoredCapture.output.results.find((result) => buildKey(result.items) === buildKey(best.items));

  const primaryVsFallback = {
    primary: searchProfileSummary(payload.items, primary),
    fallback: searchProfileSummary(conditionlessItems, fallback)
  };
  const firstLoss = fallbackBuilds[0].firstRouteLoss;

  t.diagnostic(`FALLBACK_ROUTE_DIAGNOSTIC ${JSON.stringify({
    bestBuilds: fallbackBuilds,
    requiredItemIds: {
      count: bestIds.length,
      exactBuildReturned: Boolean(anchoredExact),
      results: anchoredCapture.output.results.length,
      evaluated: anchoredCapture.output.diagnostics?.evaluated,
      valid: anchoredCapture.output.diagnostics?.valid,
      rejected: anchoredCapture.output.diagnostics?.rejected || {}
    },
    firstRouteLoss: firstLoss,
    primaryVsFallback
  })}`);

  for (const build of fallbackBuilds) {
    assert.ok(build.evaluatorValid, `fallback rank ${build.rank} must remain valid in CompleteBuildEvaluator`);
  }
});
