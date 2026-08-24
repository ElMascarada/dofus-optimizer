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

export function refineCombatTurns({
  results = [],
  spells = [],
  combatObjective = {},
  topN = 10,
  preservePrysmaradites = false,
  onProgress = null
} = {}) {
  const refined = [];
  const bestByPrysma = new Map();
  let explored = 0;
  let evaluated = 0;

  for (const build of results || []) {
    const plan = optimizeCombatSequence({
      baseStats: build.stats || {},
      baseStatsByTurn: turnStats(build),
      spells,
      objective: combatObjective,
      beamWidth: 1400,
      maxActionsPerTurn: 12
    });
    explored += Number(plan.explored || 0);
    evaluated++;
    const candidate = {
      ...build,
      equipmentScore: build.score,
      score: plan.score,
      perTurn: plan.perTurn,
      combatPlan: plan
    };
    refined.push(candidate);
    if (preservePrysmaradites) {
      const key = prysmaKey(candidate);
      const previous = bestByPrysma.get(key);
      if (!previous || Number(candidate.score || 0) > Number(previous.score || 0)) bestByPrysma.set(key, candidate);
    }
    refined.sort((a, b) => b.score - a.score || b.equipmentScore - a.equipmentScore);
    if (refined.length > Math.max(topN * 3, 30)) refined.length = Math.max(topN * 3, 30);
    if (onProgress) {
      const partialResults = preservePrysmaradites
        ? retainPrysmaVariants(refined, bestByPrysma, topN)
        : refined.slice(0, topN);
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
    ? retainPrysmaVariants(refined, bestByPrysma, Math.max(1, Number(topN || 10)))
    : refined;
  const unique = [];
  const seen = new Set();
  for (const build of ranked) {
    const key = buildKey(build);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(build);
    if (unique.length >= Math.max(1, Number(topN || 10))) break;
  }

  return {
    results: unique,
    diagnostics: {
      evaluated,
      explored,
      prysmaraditeVariants: preservePrysmaradites ? bestByPrysma.size : 0
    }
  };
}
