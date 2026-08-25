import { BASE_CHARACTER, SLOT_RULES } from '../js/config.js';
import { FM_ELIGIBLE_SLOTS } from '../js/fm.js';
import { optimisticItemStats } from '../js/search-space.js';
import { evaluateObjectiveUpperBound } from '../js/spells.js';
import { addStats, emptyStats } from '../js/stats.js';
import { applySetBonuses } from '../js/sets.js';
import { isPrysmaradite } from '../js/build-legality.js';
import { GENERIC_OFFENSE_KEYS, positiveConstraintKeys } from './candidate-policy.js';

function num(stats, key) {
  const value = Number(stats?.[key] || 0);
  return Number.isFinite(value) ? value : 0;
}

function addPositive(target, source = {}) {
  for (const [key, raw] of Object.entries(source || {})) {
    const value = Number(raw || 0);
    if (!Number.isFinite(value) || value <= 0) continue;
    target[key] = Number(target[key] || 0) + value;
  }
  return target;
}

function choiceKey(items) {
  return (items || []).map((item) => String(item.id)).sort().join('|');
}

function resourceBucket(stats, constraints = {}, prysma = 0) {
  const keys = [...new Set(['ap', 'mp', 'range', ...positiveConstraintKeys(constraints)])];
  const parts = keys.map((key) => {
    const value = Math.max(0, num(stats, key));
    const target = Math.max(0, Number(constraints?.[key] || 0));
    if (target > 0) return `${key}:${Math.min(4, Math.floor((value / target) * 4))}`;
    return `${key}:${Math.min(4, Math.round(value))}`;
  });
  return `${parts.join(',')}:p${prysma}`;
}

function keepChoiceDiversity(states, limit, context) {
  const ordered = [...states].sort((a, b) => b.score - a.score);
  const perBucket = new Map();
  const seen = new Set();
  const output = [];
  for (const state of ordered) {
    const key = choiceKey(state.items);
    if (!key || seen.has(key)) continue;
    const bucket = resourceBucket(state.optimisticStats, context.constraints, state.prysma);
    const used = perBucket.get(bucket) || 0;
    if (used >= context.profile.search.groupBucketLimit) continue;
    seen.add(key);
    perBucket.set(bucket, used + 1);
    output.push(state);
    if (output.length >= limit) break;
  }
  return output;
}

export function buildGroupChoices(profiles = [], count = 1, context = {}) {
  if (count <= 0) return [{ items: [], score: 0, optimisticStats: {}, bounded: true, prysma: 0 }];
  if (profiles.length < count) return [];
  if (count === 1) {
    return [...profiles]
      .sort((a, b) => b.rankScore - a.rankScore || String(a.item.id).localeCompare(String(b.item.id)))
      .map((entry) => ({
        items: [entry.item],
        score: entry.rankScore,
        optimisticStats: { ...entry.optimisticStats },
        bounded: entry.bounded,
        prysma: isPrysmaradite(entry.item) ? 1 : 0
      }));
  }

  const profile = context.profile;
  const beamWidth = context.slot === 'dofus'
    ? profile.search.dofusGroupBeamWidth
    : count >= 5 ? profile.search.multiPickBeamWidth : profile.search.groupBeamWidth;
  let states = [{ items: [], score: 0, next: 0, prysma: 0, optimisticStats: {}, bounded: true }];
  for (let pick = 0; pick < count; pick++) {
    const next = [];
    const leftAfter = count - pick - 1;
    for (const state of states) {
      const last = profiles.length - leftAfter;
      for (let index = state.next; index < last; index++) {
        const candidate = profiles[index];
        const prysma = state.prysma + (isPrysmaradite(candidate.item) ? 1 : 0);
        if (prysma > 1) continue;
        const stats = { ...state.optimisticStats };
        addPositive(stats, candidate.optimisticStats);
        next.push({
          items: [...state.items, candidate.item],
          score: state.score + candidate.rankScore,
          next: index + 1,
          prysma,
          optimisticStats: stats,
          bounded: state.bounded && candidate.bounded
        });
      }
    }
    states = keepChoiceDiversity(next, beamWidth, context);
    if (!states.length) break;
  }

  const softLimit = Math.max(count, Number(profile.search.groupChoiceLimits?.[context.slot] || states.length));
  const diversityLimit = Math.max(
    softLimit,
    Math.min(states.length, profile.search.groupBucketLimit * profile.search.groupDiversityMultiplier)
  );
  return keepChoiceDiversity(states, diversityLimit, context)
    .map(({ items, score, optimisticStats, bounded, prysma }) => ({ items, score, optimisticStats, bounded, prysma }));
}

export function staticBuildStats(items = [], setsById = {}) {
  const stats = emptyStats();
  addStats(stats, BASE_CHARACTER.baseStats || {});
  for (const item of items) addStats(stats, item.stats || {});
  applySetBonuses(stats, items, setsById);
  return stats;
}

function characteristicUpperAllowance(key) {
  if (key === 'vit') return Math.max(0, Number(BASE_CHARACTER.characteristicPoints || 0));
  if (['earth', 'fire', 'water', 'air'].includes(key)) {
    return Math.max(0, Number(BASE_CHARACTER.scrolled?.[key] || 0))
      + Math.max(0, Number(BASE_CHARACTER.characteristicPoints || 0));
  }
  return 0;
}

function positiveSetBonusCaps(sets = [], keys = []) {
  const result = Object.fromEntries(keys.map((key) => [key, 0]));
  for (const set of sets || []) {
    for (const key of keys) {
      let best = 0;
      for (const bonus of Object.values(set?.bonuses || {})) best = Math.max(best, Math.max(0, num(bonus, key)));
      result[key] += best;
    }
  }
  return result;
}

function remainingProfileCaps(groups = [], profilesFor, keys = []) {
  const caps = Object.fromEntries(keys.map((key) => [key, 0]));
  for (const group of groups) {
    const profiles = profilesFor(group.id) || [];
    const count = Math.max(0, Number(group.missing || 0));
    if (profiles.length < count) return { caps, bounded: true, impossibleShape: true };
    if (profiles.some((entry) => entry.bounded === false)) return { caps, bounded: false, impossibleShape: false };
    for (const key of keys) {
      const values = profiles
        .map((entry) => Math.max(0, num(entry.optimisticStats, key)))
        .sort((a, b) => b - a);
      for (let index = 0; index < count; index++) caps[key] += Number(values[index] || 0);
    }
  }
  return { caps, bounded: true, impossibleShape: false };
}

export function branchFeasibility({
  items = [],
  remainingGroups = [],
  profilesFor,
  constraints = {},
  sets = [],
  setsById = {}
} = {}) {
  const keys = positiveConstraintKeys(constraints);
  if (!keys.length) return { feasible: true, key: null, actual: 0, maximum: Infinity, target: 0 };
  const current = staticBuildStats(items, setsById);
  const remaining = remainingProfileCaps(remainingGroups, profilesFor, keys);
  if (remaining.impossibleShape) return { feasible: false, key: 'shape', actual: 0, maximum: 0, target: 1 };
  if (!remaining.bounded) return { feasible: true, key: null, actual: 0, maximum: Infinity, target: 0 };
  const setCaps = positiveSetBonusCaps(sets, keys);
  for (const key of keys) {
    const target = Number(constraints[key] || 0);
    const actual = num(current, key) + characteristicUpperAllowance(key);
    const maximum = actual + Number(remaining.caps[key] || 0) + Number(setCaps[key] || 0);
    if (maximum + 1e-9 < target) return { feasible: false, key, actual, maximum, target };
  }
  return { feasible: true, key: null, actual: 0, maximum: Infinity, target: 0 };
}

function optimisticCurrentStats(items, context) {
  const stats = {};
  addPositive(stats, BASE_CHARACTER.baseStats || {});
  for (const element of ['earth', 'fire', 'water', 'air']) {
    stats[element] = Number(stats[element] || 0) + Math.max(0, Number(BASE_CHARACTER.scrolled?.[element] || 0));
  }
  let bounded = true;
  for (const item of items || []) {
    const optimistic = optimisticItemStats(item, {
      includePassives: true,
      turnMode: context.turnMode,
      scenario: context.scenario
    });
    bounded = bounded && optimistic.bounded;
    addPositive(stats, optimistic.stats);
  }
  return { stats, bounded };
}

function forgeableSlotCount() {
  return SLOT_RULES.reduce((sum, rule) => sum + (FM_ELIGIBLE_SLOTS.has(rule.id) ? Number(rule.count || 0) : 0), 0);
}

export function offensiveUpperBound({
  items = [],
  remainingGroups = [],
  profilesFor,
  policy,
  sets = [],
  fmPolicy = {}
} = {}) {
  const relevant = new Set([
    ...policy.paretoKeys,
    ...GENERIC_OFFENSE_KEYS,
    ...policy.elements,
    ...policy.elements.map((element) => `damage${element[0].toUpperCase()}${element.slice(1)}`)
  ]);
  const keys = [...relevant];
  const current = optimisticCurrentStats(items, policy);
  const remaining = remainingProfileCaps(remainingGroups, profilesFor, keys);
  if (!current.bounded || !remaining.bounded || remaining.impossibleShape) return Infinity;
  for (const [key, value] of Object.entries(remaining.caps)) {
    current.stats[key] = Number(current.stats[key] || 0) + Number(value || 0);
  }
  addPositive(current.stats, positiveSetBonusCaps(sets, keys));

  // Safe over-estimate: grant the full characteristic budget to every active
  // element at once. A real build can never receive more than this.
  const activeElements = policy.elements.length ? policy.elements : ['earth', 'fire', 'water', 'air'];
  for (const element of activeElements) {
    current.stats[element] = Number(current.stats[element] || 0)
      + Math.max(0, Number(BASE_CHARACTER.characteristicPoints || 0));
  }

  // Safe over-estimate again: every forgeable slot receives both possible
  // offensive FM outcomes, even though optimizeFm() must choose one.
  const forgeable = forgeableSlotCount();
  current.stats.spellDamagePct = Number(current.stats.spellDamagePct || 0)
    + forgeable * Math.max(0, Number(fmPolicy?.spellDamagePct || 0));
  current.stats.critDamage = Number(current.stats.critDamage || 0)
    + forgeable * Math.max(0, Number(fmPolicy?.critDamageAmount ?? 8));
  current.stats.crit = Number(current.stats.crit || 0) + 100;

  const value = evaluateObjectiveUpperBound({
    stats: current.stats,
    selections: policy.selections,
    turnMode: policy.turnMode
  }).score;
  return Number.isFinite(value) ? value : Infinity;
}

export function fastPartialRank(items = [], policy, setsById = {}) {
  const stats = staticBuildStats(items, setsById);
  return policy.rankStats(stats).rankScore;
}
