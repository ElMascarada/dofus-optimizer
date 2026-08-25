import { finalizePartialCombatResults } from './partial-result-finalizer.js';

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'finalize-partial') return;
  const { requestId, payload = {} } = event.data;

  try {
    const output = finalizePartialCombatResults({
      results: payload.results || [],
      classSpells: payload.classSpells || [],
      combatObjective: payload.combatObjective || {},
      diversityMode: payload.diversityMode || 'gear',
      topN: payload.topN || 10,
      candidateLimit: payload.candidateLimit || 20,
      onProgress: (progress) => self.postMessage({
        type: 'progress',
        requestId,
        progress
      })
    });

    self.postMessage({ type: 'result', requestId, output });
  } catch (error) {
    self.postMessage({
      type: 'error',
      requestId,
      message: error instanceof Error ? error.message : String(error)
    });
  }
});
