import { optimizeCombatSequence } from './turn-optimizer.js';
import { combatPlanIsComplete } from './final-result-validator.js';

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
  const activeTurns = Array.isArray(plan?.objective?.activeTurns) ? plan.objective.activeTurns : [];
  const perTurn = {};
  for (const turn of activeTurns) perTurn[turn] = Number(plan?.perTurn?.[turn] || 0);
  const normalizedPlan = { ...plan, perTurn };
  return {
    ...build,
    equipmentScore: Number.isFinite(Number(build.equipmentScore)) ? Number(build.equipmentScore) : Number(build.score || 0),
    score: normalizedPlan.score,
    perTurn,
    combatPlan: normalizedPlan
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

function uniqueTop(ranked, topN, turnMode) {
  const unique = [];
  const seen = new Set();
  for (const build of ranked) {
    if (!combatPlanIsComplete(build, turnMode)) continue;
    const key = buildKey(build);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(build);
    if (unique.length >= Math.max(1, Number(topN || 10))) break;
  }
  return unique;
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
  const turnMode = combatObjective?.turnMode || 't1';
  const multiTurn = ['sum', 'average', 'min'].includes(turnMode);
  let explored = 0;
  let evaluated = 0;
  let incompletePlansRejected = 0;

  function makeCandidate(build, plan) {
    const candidate = candidateWithPlan(build, plan);
    if (!combatPlanIsComplete(candidate, turnMode)) {
      incompletePlansRejected++;
      return null;
    }
    return candidate;
  }

  // A single selected turn remains cheap enough to solve directly at the wider beam.
  if (!multiTurn) {
    const refined = [];
    const bestByPrysma = new Map();
    for (const build of results || []) {
      const plan = planForBuild(build, spells, combatObjective, { beamWidth: 1400, interTurnWidth: 24 });
      explored += Number(plan.explored || 0);
      evaluated++;
      const candidate = makeCandidate(build, plan);
      if (!candidate) continue;
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
          pruned: incompletePlansRejected,
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
      results: uniqueTop(ranked, requestedTopN, turnMode),
      diagnostics: {
        evaluated,
        explored,
        coarseEvaluated: 0,
        preciseEvaluated: evaluated,
        incompletePlansRejected,
        prysmaraditeVariants: preservePrysmaradites ? bestByPrysma.size : 0
      }
    };
  }

  // T1+T2+T3 uses two passes. Pass 1 intentionally uses a small beam so every
  // candidate gets a real playable rotation quickly. Pass 2 spends the wider
  // search only on the candidates that survived that first ranking.
  const coarse = [];
  const coarsePrysmas = new Map();
  const coarseKeep = Math.max(requestedTopN * 5, 50);
  let coarseEvaluated = 0;
  for (const build of results || []) {
    const plan = planForBuild(build, spells, combatObjective, { beamWidth: 140, interTurnWidth: 8 });
    explored += Number(plan.explored || 0);
    evaluated++;
    coarseEvaluated++;
    const candidate = makeCandidate(build, plan);
    if (!candidate) continue;
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
        pruned: incompletePlansRejected,
        best: coarse[0]?.score || 0,
        label: 'rotation rapide',
        partialResults
      });
    }
  }

  const refineLimit = Math.min(
    coarse.length,
    Math.max(requestedTopN * 2, 20)
  );
  const refinePool = preservePrysmaradites
    ? retainPrysmaVariants(coarse, coarsePrysmas, refineLimit)
    : coarse.slice(0, refineLimit);
  const refined = [];
  const refinedPrysmas = new Map();
  let preciseEvaluated = 0;

  for (const build of refinePool) {
    const plan = planForBuild(build, spells, combatObjective, { beamWidth: 700, interTurnWidth: 24 });
    explored += Number(plan.explored || 0);
    evaluated++;
    preciseEvaluated++;
    const candidate = makeCandidate(build, plan);
    if (!candidate) continue;
    refined.push(candidate);
    if (preservePrysmaradites) rememberPrysma(refinedPrysmas, candidate);
    sortedTrimmed(refined, Math.max(requestedTopN * 3, 30));

    if (onProgress) {
      const partialResults = preservePrysmaradites
        ? retainPrysmaVariants(refined, refinedPrysmas, requestedTopN)
        : refined.slice(0, requestedTopN);
      onProgress({
        phase: 'combat-turn-refine',
        nodes: evaluated,
        visited: preciseEvaluated,
        pruned: Math.max(0, coarseEvaluated - refinePool.length) + incompletePlansRejected,
        best: refined[0]?.score || coarse[0]?.score || 0,
        label: `rotation précise ${preciseEvaluated}/${refinePool.length}`,
        partialResults: partialResults.length ? partialResults : coarse.slice(0, requestedTopN)
      });
    }
  }

  const finalSource = refined.length ? refined : coarse;
  const finalPrysmas = refined.length ? refinedPrysmas : coarsePrysmas;
  const ranked = preservePrysmaradites
    ? retainPrysmaVariants(finalSource, finalPrysmas, requestedTopN)
    : finalSource;

  return {
    results: uniqueTop(ranked, requestedTopN, turnMode),
    diagnostics: {
      evaluated,
      explored,
      coarseEvaluated,
      preciseEvaluated,
      coarseCandidates: coarse.length,
      preciseCandidates: refinePool.length,
      incompletePlansRejected,
      prysmaraditeVariants: preservePrysmaradites ? finalPrysmas.size : 0
    }
  };
}
