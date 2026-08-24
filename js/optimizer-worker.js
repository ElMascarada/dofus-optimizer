import { searchArchitecturesV2 } from './architecture-search-v2.js';
import { refineOffensiveSlots } from './offensive-slot-refiner.js';

// Context-heavy Dofus passives stay outside the automatic ranking until their
// combat context is explicitly modelled. Their fixed item stats remain usable.
const IGNORED_COMPLEX_DOFUS_PASSIVES = [
  'deep-purple',
  'turquoise-blue',
  'vermilion-red',
  'yellow-ochre',
  'descent-to-abyss'
];

function activeTurns(turnMode) {
  if (turnMode === 't1') return [1];
  if (turnMode === 't2') return [2];
  if (turnMode === 't3') return [3];
  return [1, 2, 3];
}

function selectionsForTurnMode(selections = [], turnMode = 'sum') {
  const allowed = new Set(activeTurns(turnMode));
  return (selections || []).map((selection) => ({
    ...selection,
    casts: {
      1: allowed.has(1) ? Number(selection.casts?.[1] || 0) : 0,
      2: allowed.has(2) ? Number(selection.casts?.[2] || 0) : 0,
      3: allowed.has(3) ? Number(selection.casts?.[3] || 0) : 0
    }
  }));
}

function scenarioForUi(scenario = {}, turnMode = 'sum') {
  const allowed = new Set(activeTurns(turnMode));
  const requiredApByTurn = {};
  for (const turn of [1, 2, 3]) {
    if (allowed.has(turn)) requiredApByTurn[turn] = Number(scenario?.requiredApByTurn?.[turn] || 0);
  }
  return {
    ...scenario,
    requiredApByTurn,
    ignoredPassiveIds: [
      ...new Set([...(scenario.ignoredPassiveIds || []), ...IGNORED_COMPLEX_DOFUS_PASSIVES])
    ]
  };
}

function resultKey(result) {
  return (result?.items || []).map((item) => String(item.id)).sort().join('|');
}

function mergeOutputs(primary, fallback, topN) {
  const merged = [];
  const seen = new Map();
  for (const result of [...(primary?.results || []), ...(fallback?.results || [])]) {
    const key = resultKey(result);
    const previous = seen.get(key);
    if (!previous || result.score > previous.score) seen.set(key, result);
  }
  merged.push(...seen.values());
  merged.sort((a, b) => b.score - a.score);
  if (merged.length > topN) merged.length = topN;

  return {
    ...(primary || {}),
    results: merged,
    diagnostics: {
      ...(primary?.diagnostics || {}),
      fallbackUsed: Boolean(fallback),
      fallbackValid: Number(fallback?.diagnostics?.valid || 0),
      fallbackEvaluated: Number(fallback?.diagnostics?.evaluated || 0)
    }
  };
}

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'optimize') return;
  const { requestId, payload } = event.data;

  try {
    const turnMode = payload?.turnMode || 'sum';
    const selections = selectionsForTurnMode(payload?.selections, turnMode);
    const scenario = scenarioForUi(payload?.scenario, turnMode);
    const enabledSpellCount = selections.filter((selection) => selection.enabled).length;

    // One selected spell is a benchmark target, not a combo to validate.
    if (enabledSpellCount <= 1) scenario.requiredApByTurn = {};

    const normalizedPayload = {
      ...payload,
      selections,
      turnMode,
      scenario,
      // +1 PA/+1 PM are already included in BASE_CHARACTER. Every equipment
      // slot therefore remains available for offensive FM.
      fmPolicy: { ...payload?.fmPolicy, structuralExos: false }
    };

    const topN = Math.max(1, Number(payload?.topN || 10));
    const primary = searchArchitecturesV2({
      ...normalizedPayload,
      onProgress: (progress) => {
        self.postMessage({ type: 'progress', requestId, progress });
      }
    });

    let output = primary;

    // Trophy conditions can dominate the heuristic (PA/PM items in particular).
    // If that leaves us with fewer than the requested legal results, rerun the
    // same architecture search without conditional items and merge both rankings.
    if ((primary.results || []).length < topN) {
      const conditionlessItems = (normalizedPayload.items || []).filter((item) => !item.conditions);
      const fallback = searchArchitecturesV2({
        ...normalizedPayload,
        items: conditionlessItems,
        onProgress: (progress) => {
          self.postMessage({
            type: 'progress',
            requestId,
            progress: { ...progress, label: `fallback légal · ${progress.label || ''}` }
          });
        }
      });
      output = mergeOutputs(primary, fallback, topN);
    }

    // Once the set/equipment skeleton is known, companion + six Dofus/trophies
    // are re-optimized together with the REAL expected spell damage. This phase
    // correctly values crit chance and power, and lets set AP/MP free offensive
    // Dofus slots (e.g. Kokulte + Ocre vs a stat mount + AP trophy).
    if (output.results?.length) {
      const refined = refineOffensiveSlots({
        ...normalizedPayload,
        results: output.results,
        topN,
        onProgress: (progress) => {
          self.postMessage({ type: 'progress', requestId, progress });
        }
      });
      output = {
        ...output,
        results: refined.results,
        diagnostics: {
          ...(output.diagnostics || {}),
          offensiveRefine: refined.diagnostics
        }
      };
    }

    self.postMessage({ type: 'result', requestId, output });
  } catch (error) {
    self.postMessage({
      type: 'error',
      requestId,
      message: error instanceof Error ? error.message : String(error)
    });
  }
});
