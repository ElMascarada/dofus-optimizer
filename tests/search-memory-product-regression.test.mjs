import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { APP_VERSION, DEFAULT_CONSTRAINTS } from '../js/config.js';
import { createOptimizerV2Request } from '../js/optimizer-v2-orchestrator.js';
import {
  MemorySearchStore,
  SEARCH_RECORD_VERSION,
  SearchMemoryRepository
} from '../js/search-memory/search-repository.js';
import {
  createSearchVersions,
  normalizeSearchQuery,
  searchFingerprint
} from '../js/search-memory/search-query.js';

const dataset = JSON.parse(readFileSync(new URL('../data/normalized/dofus-data.json', import.meta.url), 'utf8'));
const spellData = JSON.parse(readFileSync(new URL('../data/normalized/spell-data.json', import.meta.url), 'utf8'));
const iop = (spellData.breeds || []).find((breed) => breed?.name === 'Iop');
assert.ok(iop, 'Iop must exist in canonical spell data');

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
await import(`../js/optimizer-worker.js?empty-memory-regression=${Date.now()}`);

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

test('stale empty exact memory misses, so the canonical product request executes the main Worker and returns results', async () => {
  const request = productDefaultRequest();
  assert.equal(request.constraints.ap, 12);
  assert.equal(request.constraints.mp, 6);
  assert.equal(request.constraints.initiative, 0);
  assert.equal(request.combatObjective?.element, 'earth');
  assert.equal(request.turnMode, 't1');

  const versions = createSearchVersions({ dataset, spellData, rulesVersion: APP_VERSION });
  const query = normalizeSearchQuery({ payload: request, versions });
  const fingerprint = searchFingerprint(query);
  const staleEmptyRecord = {
    schemaVersion: SEARCH_RECORD_VERSION,
    fingerprint,
    query,
    output: { results: [], diagnostics: { source: 'stale-empty-cache' } },
    createdAt: '2026-08-28T12:00:00.000Z',
    updatedAt: '2026-08-28T12:00:00.000Z'
  };
  const repository = new SearchMemoryRepository({
    store: new MemorySearchStore([staleEmptyRecord])
  });

  const exact = await repository.recallExact(query, { items: dataset.items });
  assert.equal(exact.hit, false);
  assert.equal(exact.reason, 'empty-results');

  let workerExecuted = false;
  let output = exact.output;
  let workerError = null;
  if (!exact.hit) {
    workerExecuted = true;
    const worker = runRealWorker(request, 8001);
    output = worker.output;
    workerError = worker.error;
  }

  assert.equal(workerExecuted, true, 'an empty exact record must not short-circuit the product Worker path');
  assert.equal(workerError, null, `Worker must not fail: ${workerError || ''}`);
  assert.ok((output?.results || []).length > 0, 'Iop Terre T1 defaults must produce Worker results after the stale empty cache miss');
});
