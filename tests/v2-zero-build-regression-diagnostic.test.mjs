import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULT_CONSTRAINTS, SLOT_RULES } from '../js/config.js';
import { createOptimizerV2Request } from '../js/optimizer-v2-orchestrator.js';
import { prefilterItems } from '../js/candidate-prefilter.js';
import { searchArchitecturesV2 } from '../js/architecture-search-v2.js';
import { preferCompanionVitalityOnTies } from '../js/combat-feedback.js';

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
    validByOrigin: diagnostics.validByOrigin || {}
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
  // These are the values rendered by the real V2 UI before any user edits.
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

test('diagnose canonical V2 zero-build regression through the real request and Worker pipeline', (t) => {
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
    control12Ap6MpInitiative0: control
  };

  t.diagnostic(`ZERO_BUILD_DIAGNOSTIC ${JSON.stringify(diagnostic)}`);

  assert.equal(worker.error, null, `Worker must not fail: ${worker.error || ''}`);
  assert.ok(workerResults.length > 0, 'canonical product-default Iop Terre T1 request must produce at least one Worker result');
});
