import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { prefilterItems } from '../js/candidate-prefilter.js';
import { preferCompanionVitalityOnTies } from '../js/combat-feedback.js';
import { searchArchitecturesV2 } from '../js/architecture-search-v2.js';
import { createOptimizerV2Request } from '../js/optimizer-v2-orchestrator.js';
import { buildGroupChoices } from '../optimizer/candidate-search.js';
import { getSearchProfile } from '../optimizer/search-profiles.js';

const IGNORED_COMPLEX_DOFUS_PASSIVES = [
  'deep-purple',
  'turquoise-blue',
  'vermilion-red',
  'yellow-ochre',
  'descent-to-abyss'
];

const BASELINE_EXPANDED_STATES = 991220;
const BASELINE_HEURISTIC_TRIMMED = 979855;
const PERF_HEADROOM = 1.25;

const dataset = JSON.parse(readFileSync(new URL('../data/normalized/dofus-data.json', import.meta.url), 'utf8'));
const spellData = JSON.parse(readFileSync(new URL('../data/normalized/spell-data.json', import.meta.url), 'utf8'));
const iop = (spellData.breeds || []).find((breed) => breed?.name === 'Iop');
assert.ok(iop, 'Iop must exist in canonical spell data');

function canonicalRequest() {
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

function spellMatchesElement(spell, element) {
  return (spell?.hits || []).some((hit) => hit?.element === element);
}

function workerGearSelections(request) {
  const objective = request.combatObjective || {};
  return (request.classSpells || [])
    .filter((spell) => spellMatchesElement(spell, objective.element || 'earth'))
    .map((spell) => ({
      spell: { ...spell },
      enabled: true,
      weight: 1,
      casts: { 1: 1, 2: 0, 3: 0 }
    }));
}

function canonicalPrimaryPayload() {
  const request = canonicalRequest();
  const selections = workerGearSelections(request);
  const scenario = {
    ...(request.scenario || {}),
    requiredApByTurn: {},
    ignoredPassiveIds: [
      ...new Set([...(request.scenario?.ignoredPassiveIds || []), ...IGNORED_COMPLEX_DOFUS_PASSIVES])
    ]
  };
  return {
    ...request,
    searchProfile: String(request.searchProfile || 'BALANCED').toUpperCase(),
    requiredItemIds: [...new Set((request.requiredItemIds || []).map(String).filter(Boolean))],
    items: preferCompanionVitalityOnTies(request.items || []),
    selections,
    turnMode: 't1',
    scenario,
    fmPolicy: { ...request.fmPolicy, structuralExos: false },
    topN: 90
  };
}

function buildKey(items = []) {
  return (items || []).map((item) => String(item.id)).sort().join('|');
}

function primaryDofusChoices(payload) {
  const profile = getSearchProfile(payload.searchProfile);
  const prefilter = prefilterItems({
    items: payload.items,
    sets: payload.sets,
    selections: payload.selections,
    constraints: payload.constraints,
    turnMode: payload.turnMode,
    scenario: payload.scenario,
    requiredItemIds: payload.requiredItemIds,
    searchProfile: profile
  });
  const profiles = (prefilter.pools?.dofus || [])
    .map((item) => prefilter.policy.profileItem(item))
    .sort((a, b) => b.rankScore - a.rankScore || String(a.item.id).localeCompare(String(b.item.id)));
  const setsById = Object.fromEntries((payload.sets || []).map((set) => [set.id, set]));
  return buildGroupChoices(profiles, 6, {
    policy: prefilter.policy,
    profile,
    selections: payload.selections,
    constraints: payload.constraints,
    turnMode: payload.turnMode,
    scenario: payload.scenario,
    sets: payload.sets,
    setsById,
    slot: 'dofus'
  });
}

let canonical = null;
function canonicalSearches() {
  if (canonical) return canonical;
  const payload = canonicalPrimaryPayload();
  const primary = searchArchitecturesV2(payload);
  const conditionlessItems = payload.items.filter((item) => !item.conditions);
  const fallback = searchArchitecturesV2({ ...payload, items: conditionlessItems });
  const choices = primaryDofusChoices(payload);
  const fallbackBest = fallback.results?.[0] || null;
  const targetDofus = (fallbackBest?.items || []).filter((item) => item.slot === 'dofus');
  const targetKey = buildKey(targetDofus);
  const exactFallbackDofusRepresented = targetDofus.length === 6
    && choices.some((choice) => buildKey(choice.items) === targetKey);
  canonical = { payload, primary, fallback, choices, exactFallbackDofusRepresented };
  return canonical;
}

test('canonical Iop Earth T1 12/6 primary search retains legal condition-aware routes', (t) => {
  const { primary, fallback, choices, exactFallbackDofusRepresented } = canonicalSearches();
  const primaryBestScore = Number(primary.results?.[0]?.score || 0);
  const fallbackBestScore = Number(fallback.results?.[0]?.score || 0);
  const qualityRatio = fallbackBestScore > 0 ? primaryBestScore / fallbackBestScore : 1;
  const evaluated = Number(primary.diagnostics?.evaluated || 0);
  const valid = Number(primary.diagnostics?.valid || 0);
  const itemConditionRejects = Number(primary.diagnostics?.rejected?.['item-condition'] || 0);
  const expandedStates = Number(primary.diagnostics?.expandedStates || 0);
  const heuristicTrimmed = Number(primary.diagnostics?.heuristicTrimmed || 0);
  const legalEquivalentOrBetter = primaryBestScore + 1e-9 >= fallbackBestScore;

  t.diagnostic(`CONDITION_AWARE_PRIMARY ${JSON.stringify({
    results: primary.results?.length || 0,
    evaluated,
    valid,
    itemConditionRejects,
    primaryBestScore,
    fallbackBestScore,
    qualityRatio,
    dofusChoices: choices.length,
    exactFallbackDofusRepresented,
    legalEquivalentOrBetter,
    expandedStates,
    heuristicTrimmed,
    legalCandidates: Number(primary.diagnostics?.legalCandidates || 0)
  })}`);

  assert.ok((primary.results?.length || 0) > 0, 'primary search must no longer depend on fallback to produce a build');
  assert.ok(valid > 0, 'primary search must evaluate at least one valid complete build');
  assert.ok(itemConditionRejects < evaluated, 'item-condition must no longer reject every evaluated primary build');
  assert.ok(
    exactFallbackDofusRepresented || legalEquivalentOrBetter,
    'the best conditionless fallback Dofus route must be representable, or primary must retain an equal/better legal route'
  );
  assert.ok(expandedStates <= BASELINE_EXPANDED_STATES * PERF_HEADROOM, 'condition-aware retention must not cause an expanded-state explosion');
  assert.ok(heuristicTrimmed <= BASELINE_HEURISTIC_TRIMMED * PERF_HEADROOM, 'condition-aware retention must not cause a trimming-work explosion');
});

let workerHandler = null;
let workerMessages = null;
globalThis.self = {
  addEventListener(type, handler) {
    if (type === 'message') workerHandler = handler;
  },
  postMessage(message) {
    workerMessages?.push(message);
  }
};
await import(`../js/optimizer-worker.js?condition-aware=${Date.now()}`);

function runWorker(payload) {
  workerMessages = [];
  workerHandler({ data: { type: 'optimize', requestId: 58, payload } });
  const messages = [...workerMessages];
  workerMessages = null;
  const result = messages.findLast((message) => message?.type === 'result');
  const error = messages.findLast((message) => message?.type === 'error');
  if (!result) throw new Error(error?.message || 'condition-aware canonical Worker produced no result');
  return result.output;
}

test('canonical Worker keeps fallback as a safety net while primary is independently valid', (t) => {
  const { primary } = canonicalSearches();
  const output = runWorker(canonicalRequest());
  const finalResults = output.results || [];

  t.diagnostic(`CONDITION_AWARE_WORKER ${JSON.stringify({
    primaryValid: Number(primary.diagnostics?.valid || 0),
    primaryBestScore: Number(primary.results?.[0]?.score || 0),
    fallbackUsed: Boolean(output.diagnostics?.fallbackUsed),
    fallbackValid: Number(output.diagnostics?.fallbackValid || 0),
    fallbackEvaluated: Number(output.diagnostics?.fallbackEvaluated || 0),
    finalResults: finalResults.length,
    finalBestScore: Number(finalResults[0]?.score || 0)
  })}`);

  assert.ok(Number(primary.diagnostics?.valid || 0) > 0, 'primary must be independently valid before Worker fallback/refinement');
  assert.ok(finalResults.length > 0, 'Worker must keep returning final results');
  for (const build of finalResults) {
    assert.ok(Number(build.stats?.ap || 0) >= 12, 'Worker build must satisfy AP >= 12');
    assert.ok(Number(build.stats?.mp || 0) >= 6, 'Worker build must satisfy MP >= 6');
    assert.ok(Number(build.stats?.initiative ?? 0) >= 0, 'Worker Initiative must remain effectively non-negative');
  }
});
