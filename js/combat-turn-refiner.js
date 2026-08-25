import { optimizeCombatSequence } from './turn-optimizer.js';

function buildKey(build) {
  return (build?.items || []).map((item) => String(item.id)).sort().join('|');
}

function prysmaKey(build) {
  const item = (build?.items || []).find((entry) => entry?.slotSubtype === 'prysmaradite');
  return item ? String(item.id) : 'none';
}

function turnStats(build) {
  const result = {};
  for (const turn of [1, 2, 3]) result[turn] = { ...(build?.effectiveStatsByTurn?.[turn] || build?.stats || {}) };
  return result;
}

function retainPrysmaVariants(ranked, bestByPrysma, limit) {
  const output = [];
  const seen = new Set();
  const reserved = [...bestByPrysma.values()]
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
  for (const build of [...reserved, ...ranked]) {
    const key = buildKey(build);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(build);
    if (output.length >= limit) break;
  }
  return output;
}

function rememberPrysma(map, candidate) {
  const key = prysmaKey(candidate);
  const previous = map.get(key);
  if (!previous || Number(candidate.score || 0) > Number(previous.score || 0)) map.set(key, candidate);
}

function candidateWithPlan(build, plan) {
  return {
    ...build,
    equipmentScore: Number.isFinite(Number(build.equipmentScore)) ? Number(build.equipmentScore) : Number(build.score || 0),
    score: plan.score,
    perTurn: plan.perTurn,
    combatPlan: plan
  };
}

function planForBuild(build, spells, combatObjective, { beamWidth, interTurnWidth }) {
  return optimizeCombatSequence({
    baseStats: build.stats || {},
    baseStatsByTurn: turnStats(build),
    spells,
    objective: combatObjective,
    beamWidth,
    interTurnWidth,
    maxActionsPerTurn: 12
  });
}

function sortedTrimmed(candidates, limit) {
  candidates.sort((a, b) => b.score - a.score || b.equipmentScore - a.equipmentScore);
  if (candidates.length > limit) candidates.length = limit;
  return candidates;
}

function uniqueTop(ranked, topN) {
  const unique = [];
  const seen = new Set();
  for (const build of ranked) {
    const key = buildKey(build);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(build);
    if (unique.length >= Math.max(1, Number(topN || 10))) break;
  }
  return unique;
}

function mergePreciseAndCoarse(refined, coarse, limit) {
  const bestByBuild = new Map();
  for (const candidate of [...refined, ...coarse]) {
    const key = buildKey(candidate);
    if (!key) continue;
    const previous = bestByBuild.get(key);
    if (!previous || Number(candidate.score || 0) > Number(previous.score || 0)) bestByBuild.set(key, candidate);
  }
  return [...bestByBuild.values()]
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0) || Number(b.equipmentScore || 0) - Number(a.equipmentScore || 0))
    .slice(0, Math.max(1, Number(limit || 10)));
}

export function refineCombatTurns({
  results = [],
  spells = [],
  combatObjective = {},
  topN = 10,
  preservePrysmaradites = false,
  onProgress = null
} = {}) {
  const requestedTopN = Math.max(1, Number(topN || 10));
  const multiTurn = ['sum', 'average', 'min'].includes(combatObjective?.turnMode);
  let explored = 0;
  let evaluated = 0;

  // A single selected turn remains cheap enough to solve directly at the wider beam.
  if (!multiTurn) {
    const refined = [];
    const bestByPrysma = new Map();
    for (const build of results || []) {
      const plan = planForBuild(build, spells, combatObjective, { beamWidth: 1400, interTurnWidth: 24 });
      explored += Number(plan.explored || 0);
      evaluated++;
      const candidate = candidateWithPlan(build, plan);
      refined.push(candidate);
      if (preservePrysmaradites) rememberPrysma(bestByPrysma, candidate);
      sortedTrimmed(refined, Math.max(requestedTopN * 3, 30));
      if (onProgress) {
        const partialResults = preservePrysmaradites
          ? retainPrysmaVariants(refined, bestByPrysma, requestedTopN)
          : refined.slice(0, requestedTopN);
        onProgress({
          phase: 'combat-turn-refine',
          nodes: evaluated,
          visited: evaluated,
          pruned: 0,
          best: refined[0]?.score || 0,
          label: 'meilleur tour',
          partialResults
        });
      }
    }
    const ranked = preservePrysmaradites
      ? retainPrysmaVariants(refined, bestByPrysma, requestedTopN)
      : refined;
    return {
      results: uniqueTop(ranked, requestedTopN),
      diagnostics: {
        evaluated,
        explored,
        coarseEvaluated: 0,
        preciseEvaluated: evaluated,
        prysmaraditeVariants: preservePrysmaradites ? bestByPrysma.size : 0
      }
    };
  }

  // T1+T2+T3 uses two passes. Pass 1 intentionally uses a small beam so every
  // candidate gets a real playable rotation quickly. Crucially, those coarse
  // combat plans are kept all the way to the output; the precise pass only
  // replaces a small shortlist instead of blocking the whole result set.
  const coarse = [];
  const coarsePrysmas = new Map();
  const coarseKeep = Math.max(requestedTopN * 5, 50);
  let coarseEvaluated = 0;
  for (const build of results || []) {
    const plan = planForBuild(build, spells, combatObjective, { beamWidth: 110, interTurnWidth: 6 });
    explored += Number(plan.explored || 0);
    evaluated++;
    coarseEvaluated++;
    const candidate = candidateWithPlan(build, plan);
    coarse.push(candidate);
    if (preservePrysmaradites) rememberPrysma(coarsePrysmas, candidate);
    sortedTrimmed(coarse, coarseKeep);
    if (onProgress) {
      const partialResults = preservePrysmaradites
        ? retainPrysmaVariants(coarse, coarsePrysmas, requestedTopN)
        : coarse.slice(0, requestedTopN);
      onProgress({
        phase: 'combat-turn-coarse',
        nodes: evaluated,
        visited: coarseEvaluated,
        pruned: 0,
        best: coarse[0]?.score || 0,
        label: 'rotation rapide',
        partialResults
      });
    }
  }

  // Refining 50-60 builds with a wide three-turn beam effectively recreated the
  // old state explosion. The final UI only needs a Top 10, so spend the expensive
  // search on a bounded shortlist and keep the already valid coarse plans for the rest.
  const refineLimit = Math.min(
    coarse.length,
    Math.max(12, Math.min(18, requestedTopN * 2))
  );
  const refinePool = preservePrysmaradites
    ? retainPrysmaVariants(coarse, coarsePrysmas, refineLimit)
    : coarse.slice(0, refineLimit);
  const refined = [];
  const refinedPrysmas = new Map();
  let preciseEvaluated = 0;

  for (const build of refinePool) {
    const plan = planForBuild(build, spells, combatObjective, { beamWidth: 480, interTurnWidth: 16 });
    explored += Number(plan.explored || 0);
    evaluated++;
    preciseEvaluated++;
    const candidate = candidateWithPlan(build, plan);
    refined.push(candidate);
    if (preservePrysmaradites) rememberPrysma(refinedPrysmas, candidate);
    sortedTrimmed(refined, Math.max(refineLimit, requestedTopN));

    if (onProgress) {
      const merged = mergePreciseAndCoarse(refined, coarse, requestedTopN);
      const partialResults = preservePrysmaradites
        ? retainPrysmaVariants(merged, new Map([...coarsePrysmas, ...refinedPrysmas]), requestedTopN)
        : merged;
      onProgress({
        phase: 'combat-turn-refine',
        nodes: evaluated,
        visited: preciseEvaluated,
        pruned: Math.max(0, coarseEvaluated - refinePool.length),
        best: partialResults[0]?.score || coarse[0]?.score || 0,
        label: `rotation précise ${preciseEvaluated}/${refinePool.length}`,
        partialResults
      });
    }
  }

  const finalSource = mergePreciseAndCoarse(refined, coarse, Math.max(requestedTopN * 2, requestedTopN));
  const finalPrysmas = new Map([...coarsePrysmas, ...refinedPrysmas]);
  const ranked = preservePrysmaradites
    ? retainPrysmaVariants(finalSource, finalPrysmas, requestedTopN)
    : finalSource;

  return {
    results: uniqueTop(ranked, requestedTopN),
    diagnostics: {
      evaluated,
      explored,
      coarseEvaluated,
      preciseEvaluated,
      coarseCandidates: coarse.length,
      preciseCandidates: refinePool.length,
      preciseCandidateCap: 18,
      prysmaraditeVariants: preservePrysmaradites ? finalPrysmas.size : 0
    }
  };
}
