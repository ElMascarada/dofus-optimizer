import { effectiveStat } from './stats.js';
import { spellExpectedDamage, statsForTurnDetailed } from './spells.js';
import { staticBuildStats } from '../optimizer/candidate-search.js';
import { positiveConstraintKeys } from '../optimizer/candidate-policy.js';
import { rankSetCoresForPolicy } from '../optimizer/set-core-catalog.js';

const STRUCTURAL_CONSTRAINT_KEYS = new Set(['ap', 'mp', 'range']);
const SCORE_EPSILON = 1e-9;

function noCritExplorationContext(scenario = {}) {
  return scenario?.noCrit === true
    || String(scenario?.critMode || '').toLowerCase() === 'no-crit'
    || String(scenario?.criticalMode || '').toLowerCase() === 'no-crit';
}

function explorationStats(stats = {}, noCrit = false) {
  if (!noCrit) return stats;
  return { ...stats, crit: -1000, critDamage: 0 };
}

export function setCoreFootprintSignature(occupiedSlots = {}) {
  return Object.entries(occupiedSlots || {})
    .sort(([a], [b]) => String(a).localeCompare(String(b)))
    .map(([slot, count]) => `${slot}:${Number(count || 0)}`)
    .join('|');
}

function expectedT1Score(items, staticStats, policy, noCrit) {
  const turnStats = statsForTurnDetailed(staticStats, items, 1, policy.scenario || {}).stats;
  const scoringStats = explorationStats(turnStats, noCrit);
  let score = 0;
  for (const selection of policy.selections || []) {
    if (!selection?.enabled || !selection?.spell) continue;
    const casts = Math.max(0, Number(selection.casts?.[1] ?? 1));
    const weight = Math.max(0, Number(selection.weight ?? 1));
    score += spellExpectedDamage(selection.spell, scoringStats, 1) * casts * weight;
  }
  return score;
}

function constraintMetrics(current = {}, projected = {}, constraints = {}) {
  const byKey = {};
  let total = 0;
  for (const key of positiveConstraintKeys(constraints)) {
    const target = Math.max(1, Number(constraints[key] || 0));
    const before = Number(effectiveStat(current, key) || 0);
    const after = Number(effectiveStat(projected, key) || 0);
    const deficit = Math.max(0, target - before);
    const normalized = deficit > 0
      ? Math.min(deficit, Math.max(0, after - before)) / target
      : 0;
    const weighted = STRUCTURAL_CONSTRAINT_KEYS.has(key) ? normalized * 2 : normalized;
    byKey[key] = weighted;
    total += weighted;
  }
  return { byKey, total };
}

function orderingDominates(a, b, constraintKeys) {
  let strict = false;
  for (const key of constraintKeys) {
    const av = Number(a.constraintByKey?.[key] || 0);
    const bv = Number(b.constraintByKey?.[key] || 0);
    if (av + SCORE_EPSILON < bv) return false;
    if (av > bv + SCORE_EPSILON) strict = true;
  }
  for (const key of ['expectedT1Gain', 'policyRank']) {
    const av = Number(a[key] || 0);
    const bv = Number(b[key] || 0);
    if (av + SCORE_EPSILON < bv) return false;
    if (av > bv + SCORE_EPSILON) strict = true;
  }
  return strict;
}

function markOrderingFrontier(entries, constraintKeys) {
  for (const entry of entries) entry.orderingFrontier = true;
  for (let index = 0; index < entries.length; index++) {
    for (let challenger = 0; challenger < entries.length; challenger++) {
      if (index === challenger) continue;
      if (orderingDominates(entries[challenger], entries[index], constraintKeys)) {
        entries[index].orderingFrontier = false;
        break;
      }
    }
  }
}

export function buildSetCoreFirstPlan({
  policy,
  constraints = {},
  selectedItems = [],
  setsById = {},
  enabled = true
} = {}) {
  if (!enabled || !policy?.setCoreCatalog) {
    return { seeds: [], footprints: 0, priorityFrontier: 0 };
  }
  const noCrit = noCritExplorationContext(policy.scenario || {});
  const current = staticBuildStats(selectedItems, setsById);
  const currentExpected = expectedT1Score(selectedItems, current, policy, noCrit);
  const constraintKeys = positiveConstraintKeys(constraints);
  const ranked = rankSetCoresForPolicy(policy.setCoreCatalog, policy, { limit: Infinity }).selected;
  const entries = ranked.map((core) => {
    const projectedItems = [...selectedItems, ...(core.items || [])];
    const projected = staticBuildStats(projectedItems, setsById);
    const constraint = constraintMetrics(current, projected, constraints);
    return {
      ...core,
      footprint: setCoreFootprintSignature(core.occupiedSlots),
      constraintByKey: constraint.byKey,
      constraintGain: constraint.total,
      expectedT1Gain: expectedT1Score(projectedItems, projected, policy, noCrit) - currentExpected,
      policyRank: Number(core.searchScore || policy.rankStats(explorationStats(core.searchStats || core.aggregateStats || {}, noCrit)).rankScore || 0),
      orderingFrontier: true
    };
  });

  const byFootprint = new Map();
  for (const entry of entries) {
    if (!byFootprint.has(entry.footprint)) byFootprint.set(entry.footprint, []);
    byFootprint.get(entry.footprint).push(entry);
  }
  for (const group of byFootprint.values()) markOrderingFrontier(group, constraintKeys);

  entries.sort((a, b) => {
    if (Math.abs(b.constraintGain - a.constraintGain) > SCORE_EPSILON) return b.constraintGain - a.constraintGain;
    if (Math.abs(b.expectedT1Gain - a.expectedT1Gain) > SCORE_EPSILON) return b.expectedT1Gain - a.expectedT1Gain;
    if (a.footprint === b.footprint && a.orderingFrontier !== b.orderingFrontier) return a.orderingFrontier ? -1 : 1;
    if (Math.abs(b.policyRank - a.policyRank) > SCORE_EPSILON) return b.policyRank - a.policyRank;
    if (b.pieceCount !== a.pieceCount) return b.pieceCount - a.pieceCount;
    return String(a.id).localeCompare(String(b.id));
  });
  entries.forEach((entry, index) => { entry.coreRank = index + 1; });

  return {
    seeds: entries,
    footprints: byFootprint.size,
    priorityFrontier: entries.filter((entry) => entry.orderingFrontier).length
  };
}
