import { optimizeCombatSequence } from './turn-optimizer.js';
import { combatPlanIsComplete } from './final-result-validator.js';
import { getSearchProfile } from '../optimizer/search-profiles.js';

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

function shortlistMultiTurnInputs(results, limit, preservePrysmaradites, combatBudget) {
  const ranked = [...(results || [])].sort((a, b) => equipmentScore(b) - equipmentScore(a));
  const output = [];
  const seen = new Set();

  if (preservePrysmaradites) {
    const bestByPrysma = new Map();
    for (const build of ranked) {
      const key = prysmaKey(build);
      if (!bestByPrysma.has(key)) bestByPrysma.set(key, build);
    }
    const reserveLimit = Math.min(
      Math.max(combatBudget.prysmaReserveFloor, Math.ceil(limit / combatBudget.prysmaReserveDivisor)),
      bestByPrysma.size
    );
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

function planForBuild(build, spells, combatObjective, { beamWidth, interTurnWidth, maxActionsPerTurn }) {
  return optimizeCombatSequence({
    baseStats: build.stats || {},
    baseStatsByTurn: turnStats(build),
    spells,
    objective: combatObjective,
    beamWidth,
    interTurnWidth,
    maxActionsPerTurn
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
  searchProfile = 'BALANCED',
  onProgress = null
} = {}) {
  const requestedTopN = Math.max(1, Number(topN || 10));
  const turnMode = combatObjective?.turnMode || 't1';
  const multiTurn = ['sum', 'average', 'min', 'constant'].includes(turnMode);
  const combatBudget = getSearchProfile(searchProfile).combat;
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

  if (!multiTurn) {
    const refined = [];
    const bestByPrysma = new Map();
    for (const build of results || []) {
      const plan = planForBuild(build, spells, combatObjective, {
        beamWidth: combatBudget.singleTurnBeamWidth,
        interTurnWidth: combatBudget.singleTurnInterTurnWidth,
        maxActionsPerTurn: combatBudget.maxActionsPerTurn
      });
      explored += Number(plan.explored || 0);
      evaluated++;
      const candidate = makeCandidate(build, plan);
      if (!candidate) continue;
      refined.push(candidate);
      if (preservePrysmaradites) rememberPrysma(bestByPrysma, candidate);
      sortedTrimmed(refined, Math.max(
        requestedTopN * combatBudget.singleTurnWorkingSetMultiplier,
        combatBudget.singleTurnWorkingSetFloor
      ));
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

  const inputLimit = Math.min(
    (results || []).length,
    Math.max(
      combatBudget.multiInputFloor,
      Math.min(combatBudget.multiInputCeiling, requestedTopN * combatBudget.multiInputMultiplier)
    )
  );
  const preselected = shortlistMultiTurnInputs(results, inputLimit, preservePrysmaradites, combatBudget);
  const coarse = [];
  const coarsePrysmas = new Map();
  const coarseKeep = Math.min(
    preselected.length,
    Math.max(requestedTopN * combatBudget.coarseKeepMultiplier, combatBudget.coarseKeepFloor)
  );
  let coarseEvaluated = 0;

  for (const build of preselected) {
    const plan = planForBuild(build, spells, combatObjective, {
      beamWidth: combatBudget.coarseBeamWidth,
      interTurnWidth: combatBudget.coarseInterTurnWidth,
      maxActionsPerTurn: combatBudget.maxActionsPerTurn
    });
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
    Math.max(combatBudget.preciseCandidateFloor, Math.min(combatBudget.preciseCandidateCeiling, requestedTopN))
  );
  const refinePool = preservePrysmaradites
    ? retainPrysmaVariants(coarse, coarsePrysmas, refineLimit)
    : coarse.slice(0, refineLimit);
  const refined = [];
  const refinedPrysmas = new Map();
  let preciseEvaluated = 0;

  for (const build of refinePool) {
    const plan = planForBuild(build, spells, combatObjective, {
      beamWidth: combatBudget.preciseBeamWidth,
      interTurnWidth: combatBudget.preciseInterTurnWidth,
      maxActionsPerTurn: combatBudget.maxActionsPerTurn
    });
    explored += Number(plan.explored || 0);
    evaluated++;
    preciseEvaluated++;
    const candidate = makeCandidate(build, plan);
    if (!candidate) continue;
    refined.push(candidate);
    if (preservePrysmaradites) rememberPrysma(refinedPrysmas, candidate);
    sortedTrimmed(refined, Math.max(
      requestedTopN * combatBudget.preciseWorkingSetMultiplier,
      combatBudget.preciseWorkingSetFloor
    ));

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
