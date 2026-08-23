import { buildParetoChoices } from './pareto-choices.js';
import { optimisticItemStats, pruneDominatedCandidates } from './search-space.js';

export function activeConstraintKeys(constraints = {}) {
  return Object.entries(constraints)
    .filter(([, value]) => Number.isFinite(Number(value)) && Number(value) > 0)
    .map(([key]) => key)
    .sort();
}

function optimisticConstraintCandidates(candidates, keys) {
  const originals = new Map(candidates.map((item) => [String(item.id), item]));
  const proxies = candidates.map((item) => {
    const optimistic = optimisticItemStats(item, { includePassives: true }).stats;
    const stats = { ...(item.stats || {}) };
    for (const key of keys) {
      const value = Number(optimistic[key] || 0);
      if (Number.isFinite(value) && value > Number(stats[key] || 0)) stats[key] = value;
    }
    return { ...item, stats };
  });
  return { proxies, originals };
}

function restoreOriginalItems(choice, originals) {
  return {
    ...choice,
    // Keep optimistic `stats` on the choice: it is used only as a safe feasibility
    // upper bound. Exact evaluation must always receive the original item objects.
    items: (choice.items || []).map((item) => originals.get(String(item.id)) || item)
  };
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

  // Hard feasibility must never under-estimate a conditional passive. Ocre and
  // Abyssal, for example, may provide AP/MP depending on the scenario. We therefore
  // build this frontier with each item's positive passive upper bound, while keeping
  // the original items for final scenario-aware evaluation.
  const { proxies, originals } = optimisticConstraintCandidates(candidates, keys);
  const pruned = pruneDominatedCandidates(proxies, {
    keys,
    nonMonotoneKeys: new Set(),
    groupCount: count
  });
  const pareto = buildParetoChoices(pruned.candidates, count, keys, { shouldAbort });
  const choices = pareto.choices.map((choice) => restoreOriginalItems(choice, originals));

  return {
    choices,
    keys,
    diagnostics: {
      skipped: false,
      candidatesBefore: candidates.length,
      candidatesAfter: pruned.candidates.length,
      choices: choices.length,
      generated: pareto.diagnostics.generated,
      partitions: pareto.diagnostics.partitions,
      partitionProfiles: pareto.diagnostics.partitionProfiles || [],
      dominatedRemoved: pruned.dominatedRemoved || 0,
      equivalentRemoved: pruned.equivalentRemoved || 0,
      aborted: Boolean(pareto.diagnostics.aborted)
    }
  };
}
