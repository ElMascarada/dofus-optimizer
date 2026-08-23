import { buildParetoChoices } from './pareto-choices.js';
import { pruneDominatedCandidates } from './search-space.js';

export function activeConstraintKeys(constraints = {}) {
  return Object.entries(constraints)
    .filter(([, value]) => Number.isFinite(Number(value)) && Number(value) > 0)
    .map(([key]) => key)
    .sort();
}

export function buildHardConstraintChoices(candidates = [], count = 1, constraints = {}, { shouldAbort = null } = {}) {
  const keys = activeConstraintKeys(constraints);
  if (!keys.length || Number(count || 0) <= 0) {
    return {
      choices: [],
      keys,
      diagnostics: {
        skipped: true,
        candidatesBefore: candidates.length,
        candidatesAfter: candidates.length,
        choices: 0,
        generated: 0,
        partitions: 0,
        aborted: false
      }
    };
  }

  const pruned = pruneDominatedCandidates(candidates, {
    keys,
    nonMonotoneKeys: new Set(),
    groupCount: count
  });
  const pareto = buildParetoChoices(pruned.candidates, count, keys, { shouldAbort });

  return {
    choices: pareto.choices,
    keys,
    diagnostics: {
      skipped: false,
      candidatesBefore: candidates.length,
      candidatesAfter: pruned.candidates.length,
      choices: pareto.choices.length,
      generated: pareto.diagnostics.generated,
      partitions: pareto.diagnostics.partitions,
      partitionProfiles: pareto.diagnostics.partitionProfiles || [],
      dominatedRemoved: pruned.dominatedRemoved || 0,
      equivalentRemoved: pruned.equivalentRemoved || 0,
      aborted: Boolean(pareto.diagnostics.aborted)
    }
  };
}
