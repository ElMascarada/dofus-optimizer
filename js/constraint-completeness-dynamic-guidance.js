import { dynamicProfiles } from './constraint-completeness-combat-helpers.js';
import { effectiveStat } from './stats.js';
import { spellExpectedDamage, statsForTurnDetailed } from './spells.js';
import { staticBuildStats } from '../optimizer/candidate-search.js';
import { positiveConstraintKeys } from '../optimizer/candidate-policy.js';

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

function deficitGain(current = {}, projected = {}, constraints = {}) {
  let total = 0;
  for (const key of positiveConstraintKeys(constraints)) {
    const target = Math.max(1, Number(constraints[key] || 0));
    const before = Number(effectiveStat(current, key) || 0);
    const after = Number(effectiveStat(projected, key) || 0);
    const deficit = Math.max(0, target - before);
    if (!(deficit > 0)) continue;
    const gain = Math.min(deficit, Math.max(0, after - before)) / target;
    total += STRUCTURAL_CONSTRAINT_KEYS.has(key) ? gain * 2 : gain;
  }
  return total;
}

function expectedT1ExplorationScore(items, staticStats, policy, noCrit) {
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

function mechanicCoverage(item = {}) {
  if (item?.slotSubtype === 'prysmaradite') return 2;
  return (item?.passives || []).length
    || (item?.effects || []).length
    || Object.keys(item?.turnBonuses || {}).length
    || (item?.pendingDynamicEffects || []).length
    ? 1
    : 0;
}

export function contextualDofusProfiles(group, selectedItems, setsById, policy, constraints, debugHints = null) {
  const noCrit = noCritExplorationContext(policy.scenario || {});
  const current = staticBuildStats(selectedItems, setsById);
  const currentRank = policy.rankStats(explorationStats(current, noCrit));
  const currentExpected = expectedT1ExplorationScore(selectedItems, current, policy, noCrit);
  const metrics = new Map();

  for (const profile of group.profiles || []) {
    const projectedItems = [...selectedItems, profile.item];
    const projected = staticBuildStats(projectedItems, setsById);
    const projectedRank = policy.rankStats(explorationStats(projected, noCrit));
    const optimisticRank = policy.rankStats(explorationStats(profile.optimisticStats || {}, noCrit));
    metrics.set(profile, {
      deficit: deficitGain(current, projected, constraints),
      expectedT1Gain: expectedT1ExplorationScore(projectedItems, projected, policy, noCrit) - currentExpected,
      mechanic: mechanicCoverage(profile.item),
      objective: Number(projectedRank.objective || 0) - Number(currentRank.objective || 0),
      rank: Number(noCrit ? optimisticRank.rankScore : profile.rankScore || optimisticRank.rankScore || 0)
    });
  }

  const ordered = [...(group.profiles || [])].sort((left, right) => {
    const a = metrics.get(left);
    const b = metrics.get(right);
    if (Math.abs(b.deficit - a.deficit) > SCORE_EPSILON) return b.deficit - a.deficit;
    if (Math.abs(b.expectedT1Gain - a.expectedT1Gain) > SCORE_EPSILON) return b.expectedT1Gain - a.expectedT1Gain;
    if (b.mechanic !== a.mechanic) return b.mechanic - a.mechanic;
    if (Math.abs(b.objective - a.objective) > SCORE_EPSILON) return b.objective - a.objective;
    if (Math.abs(b.rank - a.rank) > SCORE_EPSILON) return b.rank - a.rank;
    return String(left.item.id).localeCompare(String(right.item.id));
  });

  if (debugHints && !debugHints.topDofusExplorationHints) {
    debugHints.topDofusExplorationHints = ordered.slice(0, 8).map((profile) => ({
      id: String(profile.item.id),
      ...metrics.get(profile)
    }));
  }
  return ordered;
}

export function dynamicProfilesContextual(group, selectedItems, setsById, policy, constraints, debugHints = null) {
  if (group.id !== 'dofus') {
    return dynamicProfiles(group, selectedItems, setsById, policy, constraints, debugHints);
  }
  return contextualDofusProfiles(group, selectedItems, setsById, policy, constraints, debugHints);
}
