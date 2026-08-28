import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createOptimizerV2Request } from '../js/optimizer-v2-orchestrator.js';

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
await import(`../js/optimizer-worker.js?primary-condition-diagnostic=${Date.now()}`);

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

function runRealWorker(payload) {
  activeMessages = [];
  workerHandler({ data: { type: 'optimize', requestId: 1, payload } });
  const messages = [...activeMessages];
  const resultMessage = messages.findLast((message) => message?.type === 'result');
  const errorMessage = messages.findLast((message) => message?.type === 'error');
  activeMessages = null;
  if (!resultMessage) throw new Error(errorMessage?.message || 'Primary condition diagnostic: no Worker result');
  return resultMessage.output;
}

test('canonical Iop Terre T1 12/6 anchors the primary item-condition collapse', (t) => {
  const output = runRealWorker(iopEarthRequest());
  const diagnostics = output?.diagnostics || {};
  const summary = {
    legalCandidates: Number(diagnostics.legalCandidates || 0),
    evaluated: Number(diagnostics.evaluated || 0),
    valid: Number(diagnostics.valid || 0),
    rejectedItemCondition: Number(diagnostics.rejected?.['item-condition'] || 0),
    fallbackUsed: Boolean(diagnostics.fallbackUsed),
    fallbackEvaluated: Number(diagnostics.fallbackEvaluated || 0),
    fallbackValid: Number(diagnostics.fallbackValid || 0),
    finalResults: Number(output?.results?.length || 0)
  };

  t.diagnostic(`PRIMARY_CONDITION_DIAGNOSTIC ${JSON.stringify(summary)}`);

  assert.deepEqual(summary, {
    legalCandidates: 2420,
    evaluated: 704,
    valid: 0,
    rejectedItemCondition: 704,
    fallbackUsed: true,
    fallbackEvaluated: 704,
    fallbackValid: 434,
    finalResults: 11
  });
});
