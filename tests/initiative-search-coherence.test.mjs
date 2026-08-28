import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { prefilterItems } from '../js/candidate-prefilter.js';
import { createOptimizerV2Request } from '../js/optimizer-v2-orchestrator.js';

const earthSpell = {
  id: 'earth',
  hits: [{ element: 'earth', normal: [10, 10] }]
};
const earthSelections = [{ enabled: true, weight: 1, spell: earthSpell, casts: { 1: 1 } }];

function gear(id, stats, extra = {}) {
  return { id, slot: 'dofus', level: 200, stats, ...extra };
}

function ids(result) {
  return result.items.map((item) => item.id);
}

test('inactive Initiative does not reserve pure specialists but keeps independently useful items', () => {
  const fillers = Array.from({ length: 40 }, (_, index) => gear(`earth-${index}`, { earth: 200 - index }));
  const pureInitiative = gear('initiative-only', { initiative: 1000 });
  const offensiveInitiative = gear('initiative-power', { initiative: 1000, power: 90 });

  const result = prefilterItems({
    items: [...fillers, pureInitiative, offensiveInitiative],
    selections: earthSelections,
    constraints: { initiative: 0 },
    slotRules: [{ id: 'dofus', count: 6 }]
  });

  assert.ok(!ids(result).includes('initiative-only'));
  assert.ok(ids(result).includes('initiative-power'));
  assert.ok(!result.diagnostics.paretoDimensions.includes('initiative'));
  assert.equal(result.diagnostics.slots[0].specialists.initiative, undefined);
});

test('a positive Initiative constraint restores Initiative specialist protection', () => {
  const fillers = Array.from({ length: 40 }, (_, index) => gear(`earth-${index}`, { earth: 200 - index }));
  const pureInitiative = gear('initiative-only', { initiative: 1000 });

  const result = prefilterItems({
    items: [...fillers, pureInitiative],
    selections: earthSelections,
    constraints: { initiative: 1000 },
    slotRules: [{ id: 'dofus', count: 6 }]
  });

  assert.ok(ids(result).includes('initiative-only'));
  assert.ok(result.diagnostics.paretoDimensions.includes('initiative'));
  assert.ok(Number(result.diagnostics.slots[0].specialists.initiative || 0) > 0);
});

const dataset = JSON.parse(readFileSync(new URL('../data/normalized/dofus-data.json', import.meta.url), 'utf8'));
const spellData = JSON.parse(readFileSync(new URL('../data/normalized/spell-data.json', import.meta.url), 'utf8'));

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
await import(`../js/optimizer-worker.js?initiative-coherence=${Date.now()}`);

function runRealWorker(payload) {
  activeMessages = [];
  workerHandler({ data: { type: 'optimize', requestId: 1, payload } });
  const resultMessage = activeMessages.findLast((message) => message?.type === 'result');
  const errorMessage = activeMessages.findLast((message) => message?.type === 'error');
  activeMessages = null;
  if (!resultMessage) throw new Error(errorMessage?.message || 'Initiative coherence regression: no Worker result');
  return resultMessage.output;
}

test('Iop Terre T1 12/6 with inactive Initiative no longer returns pure Initiative trophies', (t) => {
  const iop = (spellData.breeds || []).find((breed) => breed?.name === 'Iop');
  assert.ok(iop, 'Iop must exist in canonical spell data');

  const payload = createOptimizerV2Request({
    dataset,
    spellData,
    classId: String(iop.id),
    element: 'earth',
    constraints: { ap: 12, mp: 6, initiative: 0 },
    turnMode: 't1',
    topN: 10
  });
  const output = runRealWorker(payload);
  const results = output?.results || [];
  assert.ok(results.length > 0, 'the certified Worker scenario must still produce results');

  for (const build of results) {
    const names = new Set((build.items || []).map((item) => item?.name));
    assert.ok(!names.has('Initiateur'), 'Initiateur must not survive solely for inactive Initiative');
    assert.ok(!names.has('Initiateur mineur'), 'Initiateur mineur must not survive solely for inactive Initiative');
  }

  const best = results[0];
  assert.ok(Number(best.score || 0) >= 4285.1832 - 1e-6, 'the targeted coherence fix must not lower the certified combat score floor');
  t.diagnostic(`INITIATIVE_COHERENCE_RESULT ${JSON.stringify({
    score: best.score,
    initiative: best.stats?.initiative,
    items: (best.items || []).map((item) => item.name)
  })}`);
});
