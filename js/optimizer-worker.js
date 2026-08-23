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

function resultKey(result) {
  return (result?.items || []).map((item) => String(item.id)).sort().join('|');
}

function mergeResults(primary = [], alternatives = [], limit = 10) {
  const byKey = new Map();
  for (const result of [...primary, ...alternatives]) {
    if (!result?.items?.length) continue;
    const key = resultKey(result);
    const previous = byKey.get(key);
    if (!previous || result.score > previous.score) byKey.set(key, result);
  }
  return [...byKey.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, Number(limit || 10)));
}

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'optimize') return;
  const { requestId, payload } = event.data;

  try {
    const requestedVariants = Math.max(1, Number(payload?.topN || 10));
    const scenario = scenarioForUi(payload?.scenario);
    const prefilter = prefilterItems({ ...payload, scenario });

    // Fast first pass: produce several valid, synergy-aware alternatives. They
    // give the exact best-search a strong starting score and are also useful as
    // instant fallback results if the user stops the calculation.
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
      topN: requestedVariants
    });

    self.postMessage({
      type: 'progress',
      requestId,
      progress: {
        nodes: 0,
        visited: seedOutput.diagnostics.visited || 0,
        pruned: seedOutput.diagnostics.pruned || 0,
        best: seedOutput.results[0]?.score || 0,
        threshold: seedOutput.results[0]?.score ?? null,
        partialResults: seedOutput.results,
        seeded: true
      }
    });

    // Important: certify the BEST build first. With topN=1, branch-and-bound can
    // prune against the current best score instead of the much weaker 10th-place
    // threshold. This is dramatically cheaper than proving an exact Top 10.
    const exactBest = optimizeBuild({
      ...payload,
      items: prefilter.items,
      scenario,
      topN: 1,
      initialResults: seedOutput.results.slice(0, 1),
      onProgress: (progress) => {
        const partial = Array.isArray(progress.partialResults) && progress.partialResults.length
          ? progress.partialResults
          : [];
        self.postMessage({
          type: 'progress',
          requestId,
          progress: {
            ...progress,
            best: progress.best || seedOutput.results[0]?.score || 0,
            partialResults: partial.length
              ? mergeResults(partial, seedOutput.results, requestedVariants)
              : null
          }
        });
      }
    });

    const results = mergeResults(exactBest.results, seedOutput.results, requestedVariants);
    const output = {
      ...exactBest,
      results,
      diagnostics: {
        ...exactBest.diagnostics,
        prefilter: prefilter.diagnostics,
        seedPrefilter: seedPrefilter.diagnostics,
        seedSearch: seedOutput.diagnostics,
        bestFirst: true,
        exactBestCount: exactBest.results.length,
        quickVariantCount: Math.max(0, results.length - exactBest.results.length)
      }
    };
    self.postMessage({ type: 'result', requestId, output });
  } catch (error) {
    self.postMessage({
      type: 'error',
      requestId,
      message: error instanceof Error ? error.message : String(error)
    });
  }
});
