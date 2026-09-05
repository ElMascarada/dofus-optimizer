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

function formatArchitectureTiming(timing = {}) {
  return [
    'totalMs',
    'eligibilityRequiredSetupMs',
    'prefilterItemsMs',
    'buildSetSynergyIndexMs',
    'slotProfilePreparationMs',
    'buildGroupChoicesMs',
    'architectureQueueStateExpansionMs',
    'completeBuildEvaluationMs',
    'otherMs'
  ].map((key) => `${key}:${Number(timing[key] || 0).toFixed(1)}`).join(';');
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
  request.architectureTiming = true;

  let workerHandler = null;
  const messages = [];
  const progressEvents = [];
  const startedAt = performance.now();
  globalThis.self = {
    addEventListener(type, handler) {
      if (type === 'message') workerHandler = handler;
    },
    postMessage(message) {
      messages.push(message);
      if (message?.type === 'progress') {
        progressEvents.push({ t: performance.now() - startedAt, progress: message.progress || {} });
      }
    }
  };
  await import('../js/optimizer-worker.js');
  assert.ok(workerHandler, 'Optimizer Worker indisponible hors UI');

  const runStartedAt = performance.now();
  workerHandler({ data: { type: 'optimize', requestId: 'search-speed-v1', payload: request } });
  const totalMs = performance.now() - runStartedAt;

  const resultMessage = messages.findLast((message) => message?.type === 'result');
  const errorMessage = messages.findLast((message) => message?.type === 'error');
  assert.equal(errorMessage, undefined, errorMessage?.error || 'worker error');
  assert.ok(resultMessage?.output?.results?.length, 'aucun résultat produit');

  const best = resultMessage.output.results[0];
  const diagnostics = resultMessage.output.diagnostics || {};
  const events = progressEvents
    .map((entry) => ({ ...entry, t: entry.t - (runStartedAt - startedAt) }))
    .filter((entry) => entry.t >= 0);
  const architectureTimingEvents = events.filter((entry) => entry.progress?.architectureTiming);
  assert.ok(architectureTimingEvents.length >= 1, 'instrumentation architecture absente');
  const phaseEvents = events.filter((entry) => !entry.progress?.architectureTiming);
  const segments = [];
  let current = null;
  const counts = new Map();
  for (const entry of phaseEvents) {
    const key = phaseKey(entry.progress);
    if (!current) {
      current = { key, start: 0, end: entry.t };
      continue;
    }
    if (key !== current.key) {
      current.end = entry.t;
      const n = (counts.get(current.key) || 0) + 1;
      counts.set(current.key, n);
      segments.push({ ...current, label: `${current.key}#${n}` });
      current = { key, start: entry.t, end: entry.t };
    } else {
      current.end = entry.t;
    }
  }
  if (current) {
    current.end = totalMs;
    const n = (counts.get(current.key) || 0) + 1;
    segments.push({ ...current, label: `${current.key}#${n}` });
  }

  const winner = (best.items || []).map((item) => item.name || item.id).join(' | ');
  console.log(`SEARCH_SPEED_V1_TIME_MS=${totalMs.toFixed(1)}`);
  console.log(`SEARCH_SPEED_V1_PHASES=${segments.map((segment) => `${segment.label}:${(segment.end - segment.start).toFixed(1)}`).join(';')}`);
  for (const entry of architectureTimingEvents) {
    const kind = String(entry.progress.label || '').startsWith('fallback légal') ? 'fallback' : 'primary';
    console.log(`ARCHITECTURE_TIMING ${kind}=${formatArchitectureTiming(entry.progress.architectureTiming)}`);
    console.log(`STATE_EXPANSION_PROFILE ${kind}=${JSON.stringify(entry.progress.architectureTiming.stateExpansionProfile || {})}`);
  }
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
