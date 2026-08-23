import { prefilterItems } from './candidate-prefilter.js';
import { optimizeBuild } from './solver.js';
import { SLOT_RULES } from './config.js';

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

function planCombinations(plans = [], items = [], limit = 12) {
  const itemById = new Map(items.map((item) => [String(item.id), item]));
  const capacity = new Map(SLOT_RULES.map((rule) => [rule.id, Number(rule.count || 0)]));
  const candidates = [];

  function compatible(combo) {
    const slots = new Map();
    const ids = new Set();
    for (const plan of combo) {
      for (const rawId of plan.memberIds || []) {
        const id = String(rawId);
        if (ids.has(id)) continue;
        const item = itemById.get(id);
        if (!item) return false;
        ids.add(id);
        const next = (slots.get(item.slot) || 0) + 1;
        if (next > (capacity.get(item.slot) || 0)) return false;
        slots.set(item.slot, next);
      }
    }
    return ids.size > 0;
  }

  function visit(start, size, combo) {
    if (combo.length === size) {
      if (compatible(combo)) {
        candidates.push({
          plans: [...combo],
          score: combo.reduce((sum, plan) => sum + Number(plan.score || 0), 0)
        });
      }
      return;
    }
    for (let index = start; index < plans.length; index++) {
      combo.push(plans[index]);
      visit(index + 1, size, combo);
      combo.pop();
    }
  }

  // Prefer ready-made structures made from three compatible sets, then two,
  // then one strong complete set.
  for (const size of [3, 2, 1]) visit(0, size, []);
  return candidates
    .sort((a, b) => b.plans.length - a.plans.length || b.score - a.score)
    .slice(0, limit);
}

function anchoredSeedPool(items = [], plans = []) {
  const anchorIds = new Set(plans.flatMap((plan) => plan.memberIds || []).map(String));
  if (!anchorIds.size) return null;
  const output = [];

  for (const rule of SLOT_RULES) {
    const slotItems = items.filter((item) => item.slot === rule.id);
    const anchors = slotItems.filter((item) => anchorIds.has(String(item.id)));
    if (anchors.length > rule.count) return null;

    if (anchors.length) {
      // Keep exactly enough non-set fillers to complete this slot. This makes
      // the requested set pieces mandatory in the seed instead of merely giving
      // them a heuristic bonus.
      const fillersNeeded = rule.count - anchors.length;
      const fillers = slotItems
        .filter((item) => !anchorIds.has(String(item.id)))
        .slice(0, fillersNeeded);
      if (fillers.length < fillersNeeded) return null;
      output.push(...anchors, ...fillers);
      continue;
    }

    const cap = Math.max(rule.count, SEED_SLOT_LIMITS[rule.id] || 2);
    output.push(...slotItems.slice(0, cap));
  }

  return output;
}

function genericSeedSearch(payload, prefilter, scenario, requestedVariants) {
  const seedPrefilter = prefilterItems({
    ...payload,
    items: prefilter.items,
    scenario,
    slotLimits: SEED_SLOT_LIMITS,
    maxRelevantSets: 3,
    constraintReservePerStat: 1
  });
  const output = optimizeBuild({
    ...payload,
    items: seedPrefilter.items,
    scenario,
    topN: requestedVariants
  });
  return { output, diagnostics: seedPrefilter.diagnostics };
}

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'optimize') return;
  const { requestId, payload } = event.data;

  try {
    const requestedVariants = Math.max(1, Number(payload?.topN || 10));
    const turnMode = payload?.turnMode || 'sum';
    const selections = selectionsForTurnMode(payload?.selections, turnMode);
    const scenario = scenarioForUi(payload?.scenario, turnMode);
    const normalizedPayload = {
      ...payload,
      selections,
      turnMode,
      scenario,
      fmPolicy: { ...payload?.fmPolicy, structuralExos: true }
    };

    const prefilter = prefilterItems(normalizedPayload);
    const setCombos = planCombinations(prefilter.diagnostics.topSetPlans || [], prefilter.items, 12);
    let seedResults = [];
    const setSeedDiagnostics = [];

    for (const combo of setCombos) {
      const seedItems = anchoredSeedPool(prefilter.items, combo.plans);
      if (!seedItems) continue;
      const seedOutput = optimizeBuild({
        ...normalizedPayload,
        items: seedItems,
        topN: Math.min(3, requestedVariants)
      });
      seedResults = mergeResults(seedResults, seedOutput.results, requestedVariants);
      setSeedDiagnostics.push({
        sets: combo.plans.map((plan) => plan.name),
        targets: combo.plans.map((plan) => plan.targetCount),
        nodes: seedOutput.diagnostics.nodes,
        visited: seedOutput.diagnostics.visited,
        best: seedOutput.results[0]?.score || 0
      });

      self.postMessage({
        type: 'progress',
        requestId,
        progress: {
          nodes: 0,
          visited: seedOutput.diagnostics.visited || 0,
          pruned: seedOutput.diagnostics.pruned || 0,
          best: seedResults[0]?.score || 0,
          threshold: seedResults[0]?.score ?? null,
          partialResults: seedResults,
          seeded: true
        }
      });
    }

    let genericSeedDiagnostics = null;
    if (!seedResults.length) {
      const fallback = genericSeedSearch(normalizedPayload, prefilter, scenario, requestedVariants);
      seedResults = fallback.output.results;
      genericSeedDiagnostics = {
        prefilter: fallback.diagnostics,
        search: fallback.output.diagnostics
      };
    }

    self.postMessage({
      type: 'progress',
      requestId,
      progress: {
        nodes: 0,
        visited: 0,
        pruned: 0,
        best: seedResults[0]?.score || 0,
        threshold: seedResults[0]?.score ?? null,
        partialResults: seedResults,
        seeded: true
      }
    });

    // Certify the best build after starting from coherent, ready-made set
    // structures. The strong initial threshold lets branch-and-bound discard
    // weak standalone paths much earlier.
    const exactBest = optimizeBuild({
      ...normalizedPayload,
      items: prefilter.items,
      topN: 1,
      initialResults: seedResults.slice(0, 1),
      onProgress: (progress) => {
        const partial = Array.isArray(progress.partialResults) && progress.partialResults.length
          ? progress.partialResults
          : [];
        self.postMessage({
          type: 'progress',
          requestId,
          progress: {
            ...progress,
            best: progress.best || seedResults[0]?.score || 0,
            partialResults: partial.length
              ? mergeResults(partial, seedResults, requestedVariants)
              : null
          }
        });
      }
    });

    const results = mergeResults(exactBest.results, seedResults, requestedVariants);
    const output = {
      ...exactBest,
      results,
      diagnostics: {
        ...exactBest.diagnostics,
        prefilter: prefilter.diagnostics,
        setSeedSearches: setSeedDiagnostics,
        genericSeed: genericSeedDiagnostics,
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
