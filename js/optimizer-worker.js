import { optimizeBuild } from './solver.js';

// UI policy: these contextual Dofus passives are deliberately not simulated yet.
// Their fixed item stats remain valid and searchable. Deterministic passives such
// as Nébuleux and Dofusteuse, plus important Prysmaradites, are still evaluated.
const IGNORED_COMPLEX_DOFUS_PASSIVES = [
  'deep-purple',
  'turquoise-blue',
  'vermilion-red',
  'yellow-ochre',
  'descent-to-abyss'
];

function scenarioForUi(scenario = {}) {
  return {
    ...scenario,
    ignoredPassiveIds: [
      ...new Set([...(scenario.ignoredPassiveIds || []), ...IGNORED_COMPLEX_DOFUS_PASSIVES])
    ]
  };
}

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'optimize') return;
  const { requestId, payload } = event.data;

  try {
    const output = optimizeBuild({
      ...payload,
      scenario: scenarioForUi(payload?.scenario),
      onProgress: (progress) => self.postMessage({ type: 'progress', requestId, progress })
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
