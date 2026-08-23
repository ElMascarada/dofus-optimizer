import { prefilterItems } from './candidate-prefilter.js';
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

const SEED_SLOT_LIMITS = Object.freeze({
  dofus: 8,
  ring: 4,
  weapon: 2,
  companion: 2,
  hat: 2,
  cape: 2,
  amulet: 2,
  belt: 2,
  boots: 2,
  shield: 2
});

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
    const scenario = scenarioForUi(payload?.scenario);
    const prefilter = prefilterItems({ ...payload, scenario });

    // Fast first pass: solve a tiny but synergy-aware shortlist. Its valid Top 10
    // becomes the initial threshold for the full exact branch-and-bound search.
    const seedPrefilter = prefilterItems({
      ...payload,
      items: prefilter.items,
      scenario,
      slotLimits: SEED_SLOT_LIMITS,
      maxRelevantSets: 3,
      constraintReservePerStat: 1
    });
    const seedOutput = optimizeBuild({
      ...payload,
      items: seedPrefilter.items,
      scenario,
      topN: payload?.topN || 10
    });

    self.postMessage({
      type: 'progress',
      requestId,
      progress: {
        nodes: 0,
        visited: seedOutput.diagnostics.visited || 0,
        pruned: seedOutput.diagnostics.pruned || 0,
        best: seedOutput.results[0]?.score || 0,
        threshold: seedOutput.results.length >= (payload?.topN || 10)
          ? seedOutput.results[seedOutput.results.length - 1].score
          : null,
        partialResults: seedOutput.results,
        seeded: true
      }
    });

    const output = optimizeBuild({
      ...payload,
      items: prefilter.items,
      scenario,
      initialResults: seedOutput.results,
      onProgress: (progress) => self.postMessage({ type: 'progress', requestId, progress })
    });
    output.diagnostics.prefilter = prefilter.diagnostics;
    output.diagnostics.seedPrefilter = seedPrefilter.diagnostics;
    output.diagnostics.seedSearch = seedOutput.diagnostics;
    self.postMessage({ type: 'result', requestId, output });
  } catch (error) {
    self.postMessage({
      type: 'error',
      requestId,
      message: error instanceof Error ? error.message : String(error)
    });
  }
});
