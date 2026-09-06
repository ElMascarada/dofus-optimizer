import { SLOT_RULES } from './config.js';
import { specialSlotRulesAreValid } from './build-legality.js';
import { effectiveStat, positiveConstraintContribution } from './stats.js';
import { spellExpectedDamage, statsForTurnDetailed } from './spells.js';
import { staticBuildStats } from '../optimizer/candidate-search.js';
import { positiveConstraintKeys } from '../optimizer/candidate-policy.js';
import { rankSetCoresForPolicy } from '../optimizer/set-core-catalog.js';

const EQUIPMENT_SLOTS = new Set(['hat', 'cape', 'amulet', 'belt', 'boots', 'weapon', 'ring', 'shield']);
const STRUCTURAL_CONSTRAINT_KEYS = new Set(['ap', 'mp', 'range']);
const EQUIPMENT_TIE_ORDER = new Map([
  ['hat', 0], ['cape', 1], ['amulet', 2], ['belt', 3],
  ['boots', 4], ['weapon', 5], ['ring', 6], ['shield', 7]
]);
const SCORE_EPSILON = 1e-9;

export function addCount(target, key) {
  target.set(key, (target.get(key) || 0) + 1);
}

function normalizeIds(values = []) {
  return [...new Set((values || []).map(String).filter(Boolean))];
}

function chooseCount(n, k) {
  const count = Math.max(0, Number(k || 0));
  const size = Math.max(0, Number(n || 0));
  if (count > size) return Infinity;
  const picked = Math.min(count, size - count);
  let value = 1;
  for (let index = 1; index <= picked; index++) {
    value *= (size - picked + index) / index;
    if (!Number.isFinite(value)) return Infinity;
  }
  return value;
}

function noCritExplorationContext(scenario = {}) {
  return scenario?.noCrit === true
    || String(scenario?.critMode || '').toLowerCase() === 'no-crit'
    || String(scenario?.criticalMode || '').toLowerCase() === 'no-crit';
}

function explorationStats(stats = {}, noCrit = false) {
  if (!noCrit) return stats;
  return { ...stats, crit: -1000, critDamage: 0 };
}

export function requiredState(eligibleItems = [], requiredItemIds = [], rejectedItemIds = []) {
  const requiredIds = normalizeIds(requiredItemIds);
  const rejected = new Set(normalizeIds(rejectedItemIds));
  const byId = new Map((eligibleItems || []).map((item) => [String(item.id), item]));
  const missingIds = requiredIds.filter((id) => !byId.has(id));
  const rejectedRequiredIds = requiredIds.filter((id) => rejected.has(id));
  if (missingIds.length || rejectedRequiredIds.length) {
    return { valid: false, requiredIds, items: [], reason: missingIds.length ? 'required-missing' : 'required-rejected' };
  }
  const items = requiredIds.map((id) => byId.get(id));
  const counts = new Map();
  for (const item of items) counts.set(item.slot, (counts.get(item.slot) || 0) + 1);
  for (const rule of SLOT_RULES) {
    if ((counts.get(rule.id) || 0) > Number(rule.count || 0)) {
      return { valid: false, requiredIds, items, reason: 'required-slot-overflow' };
    }
  }
  if (!specialSlotRulesAreValid(items)) return { valid: false, requiredIds, items, reason: 'required-special-slot' };
  return { valid: true, requiredIds, items, reason: null };
}

function insertTop(values, value, limit) {
  if (!(value > 0) || limit <= 0) return values;
  const next = [...values, value].sort((a, b) => b - a);
  if (next.length > limit) next.length = limit;
  return next;
}

export function buildSuffixCaps(profiles = [], keys = [], maxPicks = 0) {
  const n = profiles.length;
  const table = Array.from({ length: n + 1 }, () => Array(Math.max(0, maxPicks) + 1));
  const topByKey = Object.fromEntries(keys.map((key) => [key, []]));
  let unbounded = 0;

  function snapshot(start) {
    for (let count = 0; count <= maxPicks; count++) {
      const caps = Object.fromEntries(keys.map((key) => [key, 0]));
      for (const key of keys) {
        const values = topByKey[key] || [];
        for (let index = 0; index < count; index++) caps[key] += Number(values[index] || 0);
      }
      table[start][count] = {
        caps,
        bounded: count === 0 ? true : unbounded === 0,
        impossibleShape: n - start < count
      };
    }
  }

  snapshot(n);
  for (let start = n - 1; start >= 0; start--) {
    const profile = profiles[start];
    if (profile?.bounded === false) unbounded++;
    for (const key of keys) {
      const value = Math.max(0, positiveConstraintContribution(profile?.optimisticStats || {}, key));
      topByKey[key] = insertTop(topByKey[key], value, maxPicks);
    }
    snapshot(start);
  }

  return {
    get(startIndex, picks) {
      const start = Math.max(0, Math.min(n, Number(startIndex || 0)));
      const count = Math.max(0, Math.min(maxPicks, Number(picks || 0)));
      return table[start][count];
    }
  };
}

export function combineProfileCaps(remaining = [], keys = []) {
  const caps = Object.fromEntries(keys.map((key) => [key, 0]));
  let bounded = true;
  let impossibleShape = false;
  for (const group of remaining) {
    const profileCaps = group.profileCaps;
    if (!profileCaps) continue;
    bounded = bounded && profileCaps.bounded !== false;
    impossibleShape = impossibleShape || profileCaps.impossibleShape === true;
    for (const key of keys) caps[key] += Number(profileCaps.caps?.[key] || 0);
  }
  return { caps, bounded, impossibleShape };
}

function constraintPriority(profile, constraints = {}) {
  let structural = 0;
  let other = 0;
  for (const key of positiveConstraintKeys(constraints)) {
    const target = Math.max(1, Number(constraints[key] || 0));
    const value = Math.max(0, positiveConstraintContribution(profile?.optimisticStats || {}, key));
    const normalized = Math.min(1, value / target);
    if (STRUCTURAL_CONSTRAINT_KEYS.has(key)) structural += normalized;
    else other += normalized;
  }
  return structural * 2 + other;
}

export function setExplorationHints(policy, constraints = {}, noCrit = false) {
  const byItem = new Map();
  const ranked = rankSetCoresForPolicy(policy.setCoreCatalog, policy, { limit: Infinity }).selected
    .map((core) => {
      const adjusted = explorationStats(core.searchStats || core.aggregateStats || {}, noCrit);
      const rank = policy.rankStats(adjusted);
      const constraint = positiveConstraintKeys(constraints).reduce((sum, key) => {
        const target = Math.max(1, Number(constraints[key] || 0));
        const value = Math.max(0, positiveConstraintContribution(core.searchStats || core.aggregateStats || {}, key));
        return sum + Math.min(1, value / target);
      }, 0);
      return {
        ...core,
        explorationScore: Number(noCrit ? rank.rankScore : core.searchScore || rank.rankScore || 0),
        explorationConstraint: constraint
      };
    });
  ranked.sort((a, b) => b.explorationConstraint - a.explorationConstraint
    || b.explorationScore - a.explorationScore
    || b.pieceCount - a.pieceCount
    || String(a.id).localeCompare(String(b.id)));
  ranked.forEach((core, rank) => {
    for (const id of core.itemIds || []) {
      const current = byItem.get(String(id));
      const hint = { rank, score: core.explorationScore, constraint: core.explorationConstraint };
      if (!current || hint.rank < current.rank) byItem.set(String(id), hint);
    }
  });
  return { byItem, ranked };
}

export function sortEquipmentProfiles(profiles = [], constraints = {}, setByItem = new Map()) {
  const hasConstraints = positiveConstraintKeys(constraints).length > 0;
  return [...profiles].sort((left, right) => {
    const leftSet = setByItem.get(String(left.item.id));
    const rightSet = setByItem.get(String(right.item.id));
    const leftConstraint = constraintPriority(left, constraints) + Number(leftSet?.constraint || 0);
    const rightConstraint = constraintPriority(right, constraints) + Number(rightSet?.constraint || 0);
    if (hasConstraints && Math.abs(rightConstraint - leftConstraint) > SCORE_EPSILON) return rightConstraint - leftConstraint;
    return Number(rightSet ? 1 / (1 + rightSet.rank) : 0) - Number(leftSet ? 1 / (1 + leftSet.rank) : 0)
      || Number(rightSet?.score || 0) - Number(leftSet?.score || 0)
      || Number(right.rankScore || 0) - Number(left.rankScore || 0)
      || String(left.item.id).localeCompare(String(right.item.id));
  });
}

function groupCategory(group) {
  if (EQUIPMENT_SLOTS.has(group.id)) return 0;
  if (group.id === 'companion') return 1;
  if (group.id === 'dofus') return 2;
  return 1;
}

function groupConstraintPotential(group, constraints = {}) {
  let score = 0;
  for (const key of positiveConstraintKeys(constraints)) {
    const target = Math.max(1, Number(constraints[key] || 0));
    const values = (group.profiles || [])
      .map((profile) => Math.max(0, positiveConstraintContribution(profile.optimisticStats || {}, key)))
      .sort((a, b) => b - a);
    for (let index = 0; index < group.missing; index++) {
      const normalized = Math.min(1, Number(values[index] || 0) / target);
      score += STRUCTURAL_CONSTRAINT_KEYS.has(key) ? normalized * 2 : normalized;
    }
  }
  return score;
}

function groupSetPriority(group, setByItem) {
  let best = 0;
  for (const profile of group.profiles || []) {
    const set = setByItem.get(String(profile.item.id));
    if (set) best = Math.max(best, 1 / (1 + set.rank));
  }
  return best;
}

function groupSetConstraint(group, setByItem) {
  let best = 0;
  for (const profile of group.profiles || []) {
    best = Math.max(best, Number(setByItem.get(String(profile.item.id))?.constraint || 0));
  }
  return best;
}

export function sortGroupsCombat(groups = []) {
  return [...groups].sort((left, right) => {
    const category = groupCategory(left) - groupCategory(right);
    if (category) return category;
    if (groupCategory(left) === 0) {
      const leftChoices = chooseCount(left.profiles.length, left.missing);
      const rightChoices = chooseCount(right.profiles.length, right.missing);
      if (leftChoices !== rightChoices) return leftChoices - rightChoices;
      return Number(EQUIPMENT_TIE_ORDER.get(left.id) ?? 99) - Number(EQUIPMENT_TIE_ORDER.get(right.id) ?? 99)
        || left.id.localeCompare(right.id);
    }
    return left.id.localeCompare(right.id);
  });
}

export function sortGroups(groups = [], constraints = {}, setByItem = new Map()) {
  const hasConstraints = positiveConstraintKeys(constraints).length > 0;
  return [...groups].sort((left, right) => {
    const category = groupCategory(left) - groupCategory(right);
    if (category) return category;
    if (groupCategory(left) === 0) {
      const leftConstraint = groupConstraintPotential(left, constraints) + groupSetConstraint(left, setByItem);
      const rightConstraint = groupConstraintPotential(right, constraints) + groupSetConstraint(right, setByItem);
      if (hasConstraints && Math.abs(rightConstraint - leftConstraint) > SCORE_EPSILON) return rightConstraint - leftConstraint;
      const setPotential = groupSetPriority(right, setByItem) - groupSetPriority(left, setByItem);
      if (Math.abs(setPotential) > SCORE_EPSILON) return setPotential;
      const leftChoices = chooseCount(left.profiles.length, left.missing);
      const rightChoices = chooseCount(right.profiles.length, right.missing);
      if (leftChoices !== rightChoices) return leftChoices - rightChoices;
      return Number(EQUIPMENT_TIE_ORDER.get(left.id) ?? 99) - Number(EQUIPMENT_TIE_ORDER.get(right.id) ?? 99)
        || left.id.localeCompare(right.id);
    }
    return left.id.localeCompare(right.id);
  });
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

export function dynamicProfiles(group, selectedItems, setsById, policy, constraints, debugHints = null) {
  if (!['companion', 'dofus'].includes(group.id)) return group.profiles;
  const noCrit = noCritExplorationContext(policy.scenario || {});
  const current = staticBuildStats(selectedItems, setsById);
  const currentRank = policy.rankStats(explorationStats(current, noCrit));
  const currentExpected = group.id === 'companion'
    ? expectedT1ExplorationScore(selectedItems, current, policy, noCrit)
    : 0;
  const metrics = new Map();
  for (const profile of group.profiles) {
    const projectedItems = [...selectedItems, profile.item];
    const projected = staticBuildStats(projectedItems, setsById);
    const projectedRank = policy.rankStats(explorationStats(projected, noCrit));
    const optimisticRank = policy.rankStats(explorationStats(profile.optimisticStats || {}, noCrit));
    metrics.set(profile, {
      deficit: deficitGain(current, projected, constraints),
      expectedT1Gain: group.id === 'companion'
        ? expectedT1ExplorationScore(projectedItems, projected, policy, noCrit) - currentExpected
        : 0,
      objective: Number(projectedRank.objective || 0) - Number(currentRank.objective || 0),
      rank: Number(noCrit ? optimisticRank.rankScore : profile.rankScore || optimisticRank.rankScore || 0),
      prysma: group.id === 'dofus' && profile.item?.slotSubtype === 'prysmaradite' ? 1 : 0
    });
  }
  const ordered = [...group.profiles].sort((left, right) => {
    const a = metrics.get(left);
    const b = metrics.get(right);
    if (group.id === 'companion') {
      return b.deficit - a.deficit
        || b.expectedT1Gain - a.expectedT1Gain
        || b.rank - a.rank
        || String(left.item.id).localeCompare(String(right.item.id));
    }
    return b.deficit - a.deficit
      || b.prysma - a.prysma
      || b.objective - a.objective
      || b.rank - a.rank
      || String(left.item.id).localeCompare(String(right.item.id));
  });
  if (debugHints) {
    const key = group.id === 'companion' ? 'topCompanionExplorationHints' : 'topDofusExplorationHints';
    if (!debugHints[key]) {
      debugHints[key] = ordered.slice(0, 8).map((profile) => ({ id: String(profile.item.id), ...metrics.get(profile) }));
    }
  }
  return ordered;
}
