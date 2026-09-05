import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

import { createOptimizerV2Request } from '../js/optimizer-v2-orchestrator.js';
import { validateDofusSnapshot, validateSpellSnapshot } from '../js/data-loader.js';

const rawItems = JSON.parse(readFileSync(new URL('../data/normalized/dofus-data.json', import.meta.url), 'utf8'));
const rawSpells = JSON.parse(readFileSync(new URL('../data/normalized/spell-data.json', import.meta.url), 'utf8'));
const dataset = validateDofusSnapshot(rawItems);
const spellData = validateSpellSnapshot(rawSpells);
const iop = (spellData.breeds || []).find((breed) => breed?.name === 'Iop');

function phaseKey(progress = {}) {
  const phase = String(progress.phase || 'unknown');
  const fallback = String(progress.label || '').startsWith('fallback légal') ? ':fallback' : '';
  return `${phase}${fallback}`;
}

test('SEARCH SPEED V1 — real Iop Earth T1 product path', async () => {
  assert.ok(iop, 'Iop absent des données canoniques');

  const request = createOptimizerV2Request({
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

  let workerHandler = null;
  let resultMessage = null;
  let errorMessage = null;
  let runStartedAt = null;
  let currentPhaseKey = null;
  const phaseTransitions = [];

  globalThis.self = {
    addEventListener(type, handler) {
      if (type === 'message') workerHandler = handler;
    },
    postMessage(message) {
      if (message?.type === 'result') resultMessage = message;
      if (message?.type === 'error') errorMessage = message;
      if (message?.type !== 'progress' || runStartedAt === null) return;

      const key = phaseKey(message.progress || {});
      if (key === currentPhaseKey) return;
      currentPhaseKey = key;
      phaseTransitions.push({ key, t: performance.now() - runStartedAt });
    }
  };
  await import('../js/optimizer-worker.js');
  assert.ok(workerHandler, 'Optimizer Worker indisponible hors UI');

  runStartedAt = performance.now();
  workerHandler({ data: { type: 'optimize', requestId: 'search-speed-v1', payload: request } });
  const totalMs = performance.now() - runStartedAt;

  assert.equal(errorMessage, null, errorMessage?.error || 'worker error');
  assert.ok(resultMessage?.output?.results?.length, 'aucun résultat produit');

  const best = resultMessage.output.results[0];
  const diagnostics = resultMessage.output.diagnostics || {};
  const phaseCounts = new Map();
  const segments = phaseTransitions.map((transition, index) => {
    const n = (phaseCounts.get(transition.key) || 0) + 1;
    phaseCounts.set(transition.key, n);
    return {
      label: `${transition.key}#${n}`,
      duration: (phaseTransitions[index + 1]?.t ?? totalMs) - transition.t
    };
  });

  const winner = (best.items || []).map((item) => item.name || item.id).join(' | ');
  console.log(`SEARCH_SPEED_V1_TIME_MS=${totalMs.toFixed(1)}`);
  console.log(`SEARCH_SPEED_V1_PHASES=${segments.map((segment) => `${segment.label}:${segment.duration.toFixed(1)}`).join(';')}`);
  console.log(`SEARCH_SPEED_V1_WINNER=${winner}`);
  console.log(`SEARCH_SPEED_V1_SCORE=${String(best.score)}`);
  console.log(`SEARCH_SPEED_V1_DIAGNOSTICS=${JSON.stringify({
    evaluated: diagnostics.evaluated,
    valid: diagnostics.valid,
    fallbackUsed: diagnostics.fallbackUsed,
    fallbackEvaluated: diagnostics.fallbackEvaluated,
    offensiveRefine: diagnostics.offensiveRefine,
    combatFeedback: diagnostics.combatFeedback,
    combatRefine: diagnostics.combatRefine,
    finalDofusLocalRepair: diagnostics.finalDofusLocalRepair
  })}`);
});
