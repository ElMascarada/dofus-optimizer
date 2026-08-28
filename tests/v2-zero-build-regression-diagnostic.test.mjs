import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { APP_VERSION, DEFAULT_CONSTRAINTS, SLOT_RULES } from '../js/config.js';
import { createOptimizerV2Request } from '../js/optimizer-v2-orchestrator.js';
import { prefilterItems } from '../js/candidate-prefilter.js';
import { searchArchitecturesV2 } from '../js/architecture-search-v2.js';
import { preferCompanionVitalityOnTies } from '../js/combat-feedback.js';
import { mergeSearchOutputs } from '../js/search-memory/search-result-merge.js';
import { MemorySearchStore, SearchMemoryRepository } from '../js/search-memory/search-repository.js';
import { createSearchVersions, normalizeSearchQuery } from '../js/search-memory/search-query.js';

const dataset = JSON.parse(readFileSync(new URL('../data/normalized/dofus-data.json', import.meta.url), 'utf8'));
const spellData = JSON.parse(readFileSync(new URL('../data/normalized/spell-data.json', import.meta.url), 'utf8'));
const iop = (spellData.breeds || []).find((breed) => breed?.name === 'Iop');
assert.ok(iop, 'Iop must exist in canonical spell data');

const IGNORED_COMPLEX_DOFUS_PASSIVES = [
  'deep-purple',
  'turquoise-blue',
  'vermilion-red',
  'yellow-ochre',
  'descent-to-abyss'
];

let workerHandler = null;
let activeMessages = null;
globalThis.self = {
  addEventListener(type, handler) {
    if (type === 'message') workerHandler = handler;
  },
  postMessage(message) {
    activeMessages?.push(message);
  }
};
await import(`../js/optimizer-worker.js?zero-build-diagnostic=${Date.now()}`);

function runRealWorker(payload, requestId) {
  activeMessages = [];
  workerHandler({ data: { type: 'optimize', requestId, payload } });
  const messages = [...activeMessages];
  const resultMessage = messages.findLast((message) => message?.type === 'result');
  const errorMessage = messages.findLast((message) => message?.type === 'error');
  activeMessages = null;
  return {
    output: resultMessage?.output || null,
    error: errorMessage?.message || null,
    messages
  };
}

function spellMatchesElement(spell, element) {
  return (spell?.hits || []).some((hit) => hit?.element === element);
}

function workerSearchInput(request) {
  const element = request.combatObjective?.element || 'multi';
  const turnMode = request.combatObjective?.turnMode || request.turnMode || 't1';
  const selections = (request.classSpells || [])
    .filter((spell) => spellMatchesElement(spell, element))
    .map((spell) => ({
      spell: { ...spell },
      enabled: true,
      weight: 1,
      casts: {
        1: turnMode === 't1' ? 1 : 0,
        2: turnMode === 't2' ? 1 : 0,
        3: turnMode === 't3' ? 1 : 0
      }
    }));

  return {
    ...request,
    items: preferCompanionVitalityOnTies(request.items || []),
    selections,
    turnMode,
    scenario: {
      ...(request.scenario || {}),
      requiredApByTurn: {},
      ignoredPassiveIds: [
        ...new Set([...(request.scenario?.ignoredPassiveIds || []), ...IGNORED_COMPLEX_DOFUS_PASSIVES])
      ]
    },
    fmPolicy: { ...(request.fmPolicy || {}), structuralExos: false }
  };
}

function slotCounts(items = []) {
  return Object.fromEntries(SLOT_RULES.map((rule) => [
    rule.id,
    (items || []).filter((item) => item?.slot === rule.id).length
  ]));
}

function poolSummary(beforeItems, pools = {}) {
  const before = slotCounts(beforeItems);
  return Object.fromEntries(SLOT_RULES.map((rule) => {
    const after = (pools?.[rule.id] || []).length;
    return [rule.id, {
      required: Number(rule.count || 0),
      before: Number(before[rule.id] || 0),
      after,
      shortage: after < Number(rule.count || 0)
    }];
  }));
}

function activeConstraints(constraints = {}) {
  return Object.fromEntries(Object.entries(constraints || {})
    .filter(([, value]) => Number(value || 0) > 0));
}

function searchDiagnostics(output = {}) {
  const diagnostics = output?.diagnostics || {};
  return {
    results: output?.results?.length || 0,
    impossible: Boolean(diagnostics.impossible),
    reason: diagnostics.reason || null,
    evaluated: Number(diagnostics.evaluated || 0),
    valid: Number(diagnostics.valid || 0),
    legalCandidates: Number(diagnostics.legalCandidates || 0),
    expandedStates: Number(diagnostics.expandedStates || 0),
    heuristicTrimmed: Number(diagnostics.heuristicTrimmed || 0),
    safePruned: Number(diagnostics.safePruned || 0),
    rejected: diagnostics.rejected || {},
    pruneReasons: diagnostics.pruneReasons || {},
    evaluatedByOrigin: diagnostics.evaluatedByOrigin || {},
    validByOrigin: diagnostics.validByOrigin || {},
    fallbackUsed: Boolean(diagnostics.fallbackUsed),
    fallbackValid: Number(diagnostics.fallbackValid || 0),
    fallbackEvaluated: Number(diagnostics.fallbackEvaluated || 0)
  };
}

function workerProgress(messages = []) {
  return messages
    .filter((message) => message?.type === 'progress')
    .map((message) => ({
      nodes: Number(message.progress?.nodes || 0),
      visited: Number(message.progress?.visited || 0),
      pruned: Number(message.progress?.pruned || 0),
      heuristicTrimmed: Number(message.progress?.heuristicTrimmed || 0),
      best: Number(message.progress?.best || 0),
      label: message.progress?.label || ''
    }));
}

function productDefaultRequest() {
  return createOptimizerV2Request({
    dataset,
    spellData,
    classId: String(iop.id),
    element: 'earth',
    constraints: { ...DEFAULT_CONSTRAINTS, initiative: 0 },
    turnMode: 't1',
    topN: 10
  });
}

function certifiedControlRequest() {
  return createOptimizerV2Request({
    dataset,
    spellData,
    classId: String(iop.id),
    element: 'earth',
    constraints: {
      ap: 12,
      mp: 6,
      range: 0,
      vit: 0,
      initiative: 0,
      resEarth: 0,
      resFire: 0,
      resWater: 0,
      resAir: 0
    },
    turnMode: 't1',
    topN: 10
  });
}

async function exactZeroCacheDiagnostic(request) {
  const versions = createSearchVersions({ dataset, spellData, rulesVersion: APP_VERSION });
  const query = normalizeSearchQuery({ payload: request, versions });
  const cleanRepository = new SearchMemoryRepository({ store: new MemorySearchStore() });
  const clean = await cleanRepository.recallExact(query, { items: dataset.items });

  const zeroRepository = new SearchMemoryRepository({
    store: new MemorySearchStore(),
    now: () => '2026-08-28T12:00:00.000Z'
  });
  await zeroRepository.remember(query, { results: [], diagnostics: { diagnosticZero: true } });
  const exactZero = await zeroRepository.recallExact(query, { items: dataset.items });
  const appSource = readFileSync(new URL('../js/optimizer-v2-app.js', import.meta.url), 'utf8');
  const exactHitBranchBypassesWorker = appSource.includes('if (exact.hit && !workshopSeeds.length)')
    && appSource.includes('renderResults(output.results || []);')
    && appSource.includes('setIdle();\n        return;');

  return {
    appVersion: APP_VERSION,
    cleanMemoryHit: clean.hit,
    exactZeroHit: exactZero.hit,
    exactZeroResults: exactZero.output?.results?.length || 0,
    exactHitBranchBypassesWorker
  };
}

test('diagnose canonical V2 zero-build regression through the real request and Worker pipeline', async (t) => {
  const request = productDefaultRequest();
  const normalized = workerSearchInput(request);

  const prefilter = prefilterItems({
    items: normalized.items,
    sets: normalized.sets,
    selections: normalized.selections,
    constraints: normalized.constraints,
    turnMode: normalized.turnMode,
    scenario: normalized.scenario,
    requiredItemIds: normalized.requiredItemIds,
    searchProfile: normalized.searchProfile
  });
  const pools = poolSummary(normalized.items, prefilter.pools);

  const direct = searchArchitecturesV2({
    ...normalized,
    topN: 10
  });

  const worker = runRealWorker(request, 7001);
  const workerResults = worker.output?.results || [];
  const postWorkerMerge = mergeSearchOutputs(
    worker.output || { results: [], diagnostics: {} },
    { results: [], diagnostics: { seedEvaluation: { attempted: 0, valid: 0, rejected: {} } } },
    { topN: request.topN, diversityMode: request.diversityMode }
  );
  const memory = await exactZeroCacheDiagnostic(request);

  let control = null;
  if (!workerResults.length) {
    const controlRun = runRealWorker(certifiedControlRequest(), 7002);
    control = {
      results: controlRun.output?.results?.length || 0,
      error: controlRun.error,
      diagnostics: searchDiagnostics(controlRun.output),
      progress: workerProgress(controlRun.messages)
    };
  }

  const diagnostic = {
    request: {
      constraints: request.constraints,
      activeConstraints: activeConstraints(request.constraints),
      classId: request.classId,
      element: request.combatObjective?.element,
      turnMode: request.turnMode,
      items: request.items?.length || 0,
      classSpells: request.classSpells?.length || 0,
      selectionsInRequest: request.selections?.length || 0,
      selectionsForWorker: normalized.selections?.length || 0
    },
    candidatePrefilter: {
      pools,
      shortages: Object.entries(pools)
        .filter(([, value]) => value.shortage)
        .map(([slot]) => slot),
      diagnostics: prefilter.diagnostics
    },
    directSearch: {
      ...searchDiagnostics(direct),
      candidatePools: poolSummary(normalized.items, direct.candidatePools)
    },
    worker: {
      results: workerResults.length,
      error: worker.error,
      diagnostics: searchDiagnostics(worker.output),
      candidatePools: poolSummary(normalized.items, worker.output?.candidatePools),
      progress: workerProgress(worker.messages)
    },
    postWorker: {
      mergedResults: postWorkerMerge.results?.length || 0,
      searchMemory: postWorkerMerge.diagnostics?.searchMemory || {}
    },
    exactSearchMemory: memory,
    control12Ap6MpInitiative0: control
  };

  t.diagnostic(`ZERO_BUILD_DIAGNOSTIC ${JSON.stringify(diagnostic)}`);

  assert.equal(worker.error, null, `Worker must not fail: ${worker.error || ''}`);
  assert.ok(workerResults.length > 0, 'canonical product-default Iop Terre T1 request must produce at least one Worker result');
  assert.ok(postWorkerMerge.results.length > 0, 'post-Worker result merge must preserve canonical Worker results');
  assert.equal(memory.cleanMemoryHit, false, 'a clean search memory must miss before the Worker runs');
  assert.equal(memory.exactZeroHit, true, 'an exact zero-result search record is considered a compatible cache hit');
  assert.equal(memory.exactZeroResults, 0, 'the exact zero-result cache hit rehydrates as zero results');
  assert.equal(memory.exactHitBranchBypassesWorker, true, 'the product exact-hit branch renders cached results and returns before Worker dispatch');
});
