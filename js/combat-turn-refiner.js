import { optimizeCombatSequence } from './turn-optimizer.js';

function buildKey(build) {
  return (build?.items || []).map((item) => String(item.id)).sort().join('|');
}

function turnStats(build) {
  const result = {};
  for (const turn of [1, 2, 3]) result[turn] = { ...(build?.effectiveStatsByTurn?.[turn] || build?.stats || {}) };
  return result;
}

export function refineCombatTurns({
  results = [],
  spells = [],
  combatObjective = {},
  topN = 10,
  onProgress = null
} = {}) {
  const refined = [];
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
    refined.push({
      ...build,
      equipmentScore: build.score,
      score: plan.score,
      perTurn: plan.perTurn,
      combatPlan: plan
    });
    refined.sort((a, b) => b.score - a.score || b.equipmentScore - a.equipmentScore);
    if (refined.length > Math.max(topN * 3, 30)) refined.length = Math.max(topN * 3, 30);
    if (onProgress) {
      onProgress({
        phase: 'combat-turn-refine',
        nodes: evaluated,
        visited: evaluated,
        pruned: 0,
        best: refined[0]?.score || 0,
        label: 'meilleur tour',
        partialResults: refined.slice(0, topN)
      });
    }
  }

  const unique = [];
  const seen = new Set();
  for (const build of refined) {
    const key = buildKey(build);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(build);
    if (unique.length >= Math.max(1, Number(topN || 10))) break;
  }

  return {
    results: unique,
    diagnostics: { evaluated, explored }
  };
}
