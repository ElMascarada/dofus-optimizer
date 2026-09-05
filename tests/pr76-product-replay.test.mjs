import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createOptimizerV2Request } from '../js/optimizer-v2-orchestrator.js';
import { validateDofusSnapshot, validateSpellSnapshot } from '../js/data-loader.js';

const PRODUCT_SPELL_IDS = [
  'spell-13106',
  'spell-13123',
  'spell-13125',
  'spell-13156',
  'spell-13138',
  'spell-13146',
  'spell-13124'
];

test('PR76 product replay runs the exact Iop Earth T1 selection through the normal Worker search', async () => {
  const dataset = validateDofusSnapshot(JSON.parse(
    readFileSync(new URL('../data/normalized/dofus-data.json', import.meta.url), 'utf8')
  ));
  const spellData = validateSpellSnapshot(JSON.parse(
    readFileSync(new URL('../data/normalized/spell-data.json', import.meta.url), 'utf8')
  ));

  const selectedIds = new Set(PRODUCT_SPELL_IDS);
  const classSpells = (spellData.spells || []).filter((spell) => selectedIds.has(String(spell.id)));
  assert.equal(classSpells.length, PRODUCT_SPELL_IDS.length, 'all seven certified product spells must exist');
  assert.deepEqual(
    [...classSpells.map((spell) => String(spell.id))].sort(),
    [...PRODUCT_SPELL_IDS].sort(),
    'the replay must use exactly the certified product selection'
  );

  const request = createOptimizerV2Request({
    dataset,
    spellData,
    classId: 'breed-8',
    element: 'earth',
    constraints: { ap: 12, mp: 6 },
    turnMode: 't1',
    topN: 10
  });
  request.classSpells = classSpells;

  let workerHandler = null;
  const messages = [];
  globalThis.self = {
    addEventListener(type, handler) {
      if (type === 'message') workerHandler = handler;
    },
    postMessage(message) {
      messages.push(message);
    }
  };
  await import(`../js/optimizer-worker.js?pr76-product-replay=${Date.now()}`);
  assert.ok(workerHandler, 'Optimizer Worker must register its message handler');

  workerHandler({
    data: {
      type: 'optimize',
      requestId: 'pr76-product-replay',
      payload: request
    }
  });

  const errorMessage = messages.findLast((message) => message?.type === 'error');
  assert.equal(errorMessage, undefined, errorMessage?.error || 'normal Worker replay must not fail');
  const resultMessage = messages.findLast((message) => message?.type === 'result');
  assert.ok(resultMessage, 'normal Worker replay must return a result');

  const output = resultMessage.output || { results: [], diagnostics: {} };
  const results = output.results || [];
  assert.ok(results.length > 0, 'normal Worker replay must return at least one legal build');

  const resultSummary = results.map((result, index) => ({
    rank: index + 1,
    score: Number(result.score || 0),
    itemIds: (result.items || []).map((item) => String(item.id)).sort(),
    dofusIds: (result.items || [])
      .filter((item) => item?.slot === 'dofus')
      .map((item) => String(item.id))
      .sort()
  }));
  console.log(`PR76_PRODUCT_REPLAY=${JSON.stringify({
    classId: request.classId,
    element: request.combatObjective.element,
    turnMode: request.turnMode,
    spellIds: PRODUCT_SPELL_IDS,
    constraints: { ap: request.constraints.ap, mp: request.constraints.mp },
    workerCalls: 1,
    diagnostics: {
      valid: Number(output.diagnostics?.valid || 0),
      evaluated: Number(output.diagnostics?.evaluated || 0),
      fallbackUsed: Boolean(output.diagnostics?.fallbackUsed),
      fallbackValid: Number(output.diagnostics?.fallbackValid || 0)
    },
    results: resultSummary
  })}`);
});
