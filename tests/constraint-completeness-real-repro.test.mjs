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
  const startedAt = performance.now();
  workerHandler({ data: { type: 'optimize', requestId: 1, payload } });
  const elapsedMs = performance.now() - startedAt;
  const messages = [...activeMessages];
  const resultMessage = messages.findLast((message) => message?.type === 'result');
  const errorMessage = messages.findLast((message) => message?.type === 'error');
  activeMessages = null;
  if (!resultMessage) throw new Error(errorMessage?.message || 'constraint completeness real repro returned no Worker result');
  return { output: resultMessage.output, messages, elapsedMs };
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

  const { output, messages, elapsedMs } = runWorker(request);
  const best = output?.results?.[0];
  assert.ok(best, 'FEASIBLE SET NON-EMPTY => SEARCH MUST RETURN A RESULT');
  assert.ok(Number(best.stats?.ap || 0) >= 12);
  assert.ok(Number(best.stats?.mp || 0) >= 6);
  assert.ok(Number(best.stats?.initiative || 0) >= 4000);

  const diagnostics = output?.diagnostics || {};
  t.diagnostic(`TIME_TOTAL=${Math.round(elapsedMs * 10) / 10}`);
  t.diagnostic(`RESCUE_USED=${diagnostics.constraintRescueUsed === true ? 'YES' : 'NO'}`);
  t.diagnostic(`GROUP_ORDER=${(diagnostics.constraintRescueGroupOrder || []).join('->')}`);
  t.diagnostic(`NODES=${Number(diagnostics.constraintRescueNodes || 0)}`);
  t.diagnostic(`LEAVES=${Number(diagnostics.constraintRescueLeaves || 0)}`);
  t.diagnostic(`PRUNED=${Number(diagnostics.constraintRescuePruned || 0)}`);
  t.diagnostic(`FIRST_VALID_NODE=${diagnostics.constraintRescueFirstIncumbentAtNode ?? 'NONE'}`);
  t.diagnostic(`VALID=${Number(diagnostics.constraintRescueValid || 0)}`);
  t.diagnostic(`WINNER_SCORE=${Number(best.score || 0)}`);
  t.diagnostic(`WINNER_AP=${Number(best.stats?.ap || 0)}`);
  t.diagnostic(`WINNER_PM=${Number(best.stats?.mp || 0)}`);
  t.diagnostic(`WINNER_INITIATIVE=${Number(best.stats?.initiative || 0)}`);
  t.diagnostic(`RESCUE_ELAPSED_MS=${Number(diagnostics.constraintRescueElapsedMs || 0)}`);
  t.diagnostic(`PROGRESS_MESSAGES=${messages.filter((message) => message?.type === 'progress' && message?.progress?.phase === 'constraint-rescue').length}`);
});
