import { optimizeCombatSequence } from './turn-optimizer.js';
import { combatPlanIsComplete } from './final-result-validator.js';

function buildKey(build) {
  return (build?.items || []).map((item) => String(item.id)).sort().join('|');
}

function prysmaKey(build) {
  const item = (build?.items || []).find((entry) => entry?.slotSubtype === 'prysmaradite');
  return item ? String(item.id) : 'none';
}

function equipmentScore(build) {
  const value = Number(build?.equipmentScore ?? build?.score ?? 0);
  return Number.isFinite(value) ? value : 0;
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

function shortlistMultiTurnInputs(results, limit, preservePrysmaradites) {
  const ranked = [...(results || [])]
    .sort((a, b) => equipmentScore(b) - equipmentScore(a));
  const output = [];
  const seen = new Set();

  // Keep a small Prysmaradite reserve because their temporary turn effects can
  // invert the gear-only ranking. The rest of the shortlist stays performance
  // based, so preserving diversity does not make us solve dozens of rotations.
  if (preservePrysmaradites) {
    const bestByPrysma = new Map();
    for (const build of ranked) {
      const key = prysmaKey(build);
      if (!bestByPrysma.has(key)) bestByPrysma.set(key, build);
    }
    const reserveLimit = Math.min(Math.max(4, Math.ceil(limit / 3)), bestByPrysma.size);
    for (const build of [...bestByPrysma.values()].sort((a, b) => equipmentScore(b) - equipmentScore(a)).slice(0, reserveLimit)) {
      const key = buildKey(build);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      output.push(build);
    }
  }

  for (const build of ranked) {
    const key = buildKey(build);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(build);
    if (output.length >= limit) break;
  }
  return output;
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

  // T1/T2/T3 alone deliberately keep the previous wide search. The user-facing
  // slowdown was the combinatorial bridge across all three turns, not T1.
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
        inputCandidates: (results || []).length,
        preselectedCandidates: (results || []).length,
        coarseEvaluated: 0,
        preciseEvaluated: evaluated,
        incompletePlansRejected,
        prysmaraditeVariants: preservePrysmaradites ? bestByPrysma.size : 0
      }
    };
  }

  // Three-turn solving is orders of magnitude more expensive than gear scoring.
  // Rank gear cheaply first, keep a bounded strategic/Prysmaradite shortlist,
  // then spend the combat beam only where it can affect the final Top 10.
  const inputLimit = Math.min((results || []).length, Math.max(24, Math.min(36, requestedTopN * 2)));
  const preselected = shortlistMultiTurnInputs(results, inputLimit, preservePrysmaradites);
  const coarse = [];
  const coarsePrysmas = new Map();
  const coarseKeep = Math.min(preselected.length, Math.max(requestedTopN * 2, 20));
  let coarseEvaluated = 0;

  for (const build of preselected) {
    const plan = planForBuild(build, spells, combatObjective, { beamWidth: 90, interTurnWidth: 6 });
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
        ? retainPrysmaVariants(coarse, coarsePrysmas, Math.min(requestedTopN, coarse.length))
        : coarse.slice(0, requestedTopN);
      onProgress({
        phase: 'combat-turn-coarse',
        nodes: evaluated,
        visited: coarseEvaluated,
        pruned: Math.max(0, (results || []).length - preselected.length) + incompletePlansRejected,
        best: coarse[0]?.score || 0,
        label: `rotation rapide ${coarseEvaluated}/${preselected.length}`,
        partialResults
      });
    }
  }

  const refineLimit = Math.min(
    coarse.length,
    Math.max(10, Math.min(14, requestedTopN))
  );
  const refinePool = preservePrysmaradites
    ? retainPrysmaVariants(coarse, coarsePrysmas, refineLimit)
    : coarse.slice(0, refineLimit);
  const refined = [];
  const refinedPrysmas = new Map();
  let preciseEvaluated = 0;

  for (const build of refinePool) {
    const plan = planForBuild(build, spells, combatObjective, { beamWidth: 420, interTurnWidth: 12 });
    explored += Number(plan.explored || 0);
    evaluated++;
    preciseEvaluated++;
    const candidate = makeCandidate(build, plan);
    if (!candidate) continue;
    refined.push(candidate);
    if (preservePrysmaradites) rememberPrysma(refinedPrysmas, candidate);
    sortedTrimmed(refined, Math.max(requestedTopN * 2, 20));

    if (onProgress) {
      const partialResults = preservePrysmaradites
        ? retainPrysmaVariants(refined, refinedPrysmas, Math.min(requestedTopN, refined.length))
        : refined.slice(0, requestedTopN);
      onProgress({
        phase: 'combat-turn-refine',
        nodes: evaluated,
        visited: preciseEvaluated,
        pruned: Math.max(0, (results || []).length - preselected.length)
          + Math.max(0, coarseEvaluated - refinePool.length)
          + incompletePlansRejected,
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
      inputCandidates: (results || []).length,
      preselectedCandidates: preselected.length,
      inputPruned: Math.max(0, (results || []).length - preselected.length),
      coarseEvaluated,
      preciseEvaluated,
      coarseCandidates: coarse.length,
      preciseCandidates: refinePool.length,
      incompletePlansRejected,
      prysmaraditeVariants: preservePrysmaradites ? finalPrysmas.size : 0
    }
  };
}
