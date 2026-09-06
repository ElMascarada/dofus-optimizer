import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createOptimizerV2Request } from '../js/optimizer-v2-orchestrator.js';

const RUN_REAL_REPRO = process.env.RUN_CONSTRAINT_RESCUE_REAL === '1';

const dataset = JSON.parse(readFileSync(new URL('../data/normalized/dofus-data.json', import.meta.url), 'utf8'));
const spellData = JSON.parse(readFileSync(new URL('../data/normalized/spell-data.json', import.meta.url), 'utf8'));
const zobal = (spellData.breeds || []).find((breed) => breed?.name === 'Zobal');
assert.ok(zobal, 'Zobal must exist in canonical spell data');

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
await import(`../js/optimizer-worker.js?constraint-real-repro=${Date.now()}`);

function runWorker(payload) {
  activeMessages = [];
  workerHandler({ data: { type: 'optimize', requestId: 1, payload } });
  const messages = [...activeMessages];
  const resultMessage = messages.findLast((message) => message?.type === 'result');
  const errorMessage = messages.findLast((message) => message?.type === 'error');
  activeMessages = null;
  if (!resultMessage) throw new Error(errorMessage?.message || 'constraint completeness real repro returned no Worker result');
  return { output: resultMessage.output, messages };
}

test('Steam final: Zobal Multi T1 12/6 Initiative 4000 returns a motor-valid build', {
  skip: !RUN_REAL_REPRO
}, (t) => {
  const request = createOptimizerV2Request({
    dataset,
    spellData,
    classId: String(zobal.id),
    element: 'multi',
    constraints: { ap: 12, mp: 6, initiative: 4000 },
    turnMode: 't1',
    topN: 1
  });

  const { output, messages } = runWorker(request);
  const best = output?.results?.[0];
  assert.ok(best, 'FEASIBLE SET NON-EMPTY => SEARCH MUST RETURN A RESULT');
  assert.ok(Number(best.stats?.ap || 0) >= 12);
  assert.ok(Number(best.stats?.mp || 0) >= 6);
  assert.ok(Number(best.stats?.initiative || 0) >= 4000);
  t.diagnostic(`CONSTRAINT_RESCUE_REAL ${JSON.stringify({
    rescueUsed: output?.diagnostics?.constraintRescueUsed,
    nodes: output?.diagnostics?.constraintRescueNodes,
    pruned: output?.diagnostics?.constraintRescuePruned,
    evaluated: output?.diagnostics?.constraintRescueEvaluated,
    valid: output?.diagnostics?.constraintRescueValid,
    exhausted: output?.diagnostics?.constraintRescueExhausted,
    score: best.score,
    progressMessages: messages.filter((message) => message?.type === 'progress' && message?.progress?.phase === 'constraint-rescue').length
  })}`);
});
