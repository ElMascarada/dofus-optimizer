import { SLOT_RULES } from '../js/config.js';
import { evaluateObjectiveUpperBound } from '../js/spells.js';
import {
  collectConditionStatInfo,
  optimisticItemStats,
  pruneDominatedCandidates,
  relevantStatKeys
} from '../js/search-space.js';
import { getSearchProfile } from './search-profiles.js';

const ELEMENTS = Object.freeze(['earth', 'fire', 'water', 'air']);
const ELEMENT_DAMAGE = Object.freeze({
  earth: 'damageEarth',
  fire: 'damageFire',
  water: 'damageWater',
  air: 'damageAir'
});

export const GENERIC_OFFENSE_KEYS = Object.freeze([
  'power', 'damage', 'crit', 'critDamage', 'spellDamagePct',
  'meleeDamagePct', 'rangedDamagePct', 'weaponDamagePct',
  'finalDamagePct', 'finalDamagePctT1', 'finalDamagePctT2', 'finalDamagePctT3'
]);

export const STRUCTURAL_SPECIALIST_KEYS = Object.freeze([
  'ap', 'mp', 'range', 'initiative', 'vit',
  'resNeutral', 'resEarth', 'resFire', 'resWater', 'resAir',
  'crit', 'critDamage', 'power'
]);

function num(stats, key) {
  const value = Number(stats?.[key] || 0);
  return Number.isFinite(value) ? value : 0;
}

function addStats(target, source = {}) {
  for (const [key, raw] of Object.entries(source || {})) {
    const value = Number(raw || 0);
    if (!Number.isFinite(value) || value === 0) continue;
    target[key] = Number(target[key] || 0) + value;
  }
  return target;
}

function normalizedHitElement(element) {
  return element === 'neutral' ? 'earth' : element;
}

export function activeSpellElements(selections = []) {
  const elements = new Set();
  for (const selection of selections || []) {
    if (!selection?.enabled) continue;
    for (const hit of selection.spell?.hits || []) {
      const element = normalizedHitElement(hit.element || 'earth');
      if (ELEMENTS.includes(element)) elements.add(element);
    }
  }
  return [...elements];
}

export function positiveConstraintKeys(constraints = {}) {
  return Object.entries(constraints || {})
    .filter(([, minimum]) => Number.isFinite(Number(minimum)) && Number(minimum) > 0)
    .map(([key]) => key)
    .sort();
}

function constraintOrderingSignal(stats, constraints = {}) {
  let signal = 0;
  for (const key of positiveConstraintKeys(constraints)) {
    const target = Math.max(1, Number(constraints[key] || 0));
    signal += Math.min(1, Math.max(0, num(stats, key)) / target);
  }
  return signal;
}

function targetElementSignal(stats, targetElement) {
  if (!targetElement) return 0;
  return Math.max(0, num(stats, targetElement))
    + Math.max(0, num(stats, ELEMENT_DAMAGE[targetElement]));
}

function genericOffenseSignal(stats) {
  return GENERIC_OFFENSE_KEYS.reduce((sum, key) => sum + Math.max(0, num(stats, key)), 0);
}

function hasUniqueMechanic(item = {}) {
  return Boolean(
    (item.passives || []).length
    || (item.effects || []).length
    || Object.keys(item.turnBonuses || {}).length
    || (item.pendingDynamicEffects || []).length
    || item.slotSubtype === 'prysmaradite'
  );
}

function slotCapacities(slotRules = SLOT_RULES) {
  return new Map((slotRules || SLOT_RULES).map((rule) => [rule.id, Math.max(1, Number(rule.count || 1))]));
}

function chooseSetMembers(profiles, count, capacities) {
  const chosen = [];
  const bySlot = new Map();
  for (const entry of [...profiles].sort((a, b) => b.rankScore - a.rankScore || String(a.item.id).localeCompare(String(b.item.id)))) {
    const slot = entry.item?.slot;
    const capacity = capacities.get(slot) || 1;
    const used = bySlot.get(slot) || 0;
    if (used >= capacity) continue;
    chosen.push(entry);
    bySlot.set(slot, used + 1);
    if (chosen.length >= count) break;
  }
  return chosen;
}

function buildSetCoreHints(sets, items, policy, slotRules) {
  const profilesBySet = new Map();
  for (const item of items || []) {
    if (!item?.setId) continue;
    if (!profilesBySet.has(item.setId)) profilesBySet.set(item.setId, []);
    profilesBySet.get(item.setId).push(policy.profileItem(item));
  }

  const capacities = slotCapacities(slotRules);
  const plans = [];
  for (const set of sets || []) {
    const members = profilesBySet.get(set?.id) || [];
    if (!members.length) continue;
    let best = null;
    for (const [countText, bonus] of Object.entries(set?.bonuses || {})) {
      const count = Number(countText);
      if (!Number.isInteger(count) || count < 2) continue;
      const selected = chooseSetMembers(members, count, capacities);
      if (selected.length < count) continue;
      const combined = {};
      for (const member of selected) addStats(combined, member.optimisticStats);
      addStats(combined, bonus);
      const combinedRank = policy.rankStats(combined);
      const bonusRank = policy.rankStats(bonus || {});
      const constraintSignal = constraintOrderingSignal(combined, policy.constraints);
      const relevant = combinedRank.objectiveGain > 0
        || bonusRank.objectiveGain > 0
        || constraintSignal > 0
        || num(bonus, 'ap') > 0
        || num(bonus, 'mp') > 0
        || num(bonus, 'range') > 0;
      if (!relevant) continue;
      const score = combinedRank.rankScore + bonusRank.rankScore
        + constraintSignal * policy.profile.ranking.constraintWeight;
      if (!best || score > best.score) {
        best = {
          setId: set.id,
          name: set.name || set.id,
          targetCount: count,
          score,
          memberIds: selected.map((entry) => String(entry.item.id))
        };
      }
    }
    if (best) plans.push(best);
  }

  return plans
    .sort((a, b) => b.score - a.score || b.targetCount - a.targetCount)
    .slice(0, policy.profile.candidate.maxSetCorePlans);
}

function specialistDefinitions(policy) {
  const definitions = STRUCTURAL_SPECIALIST_KEYS.map((key) => ({ id: key, keys: [key] }));
  for (const key of GENERIC_OFFENSE_KEYS) {
    if (!definitions.some((definition) => definition.id === key)) definitions.push({ id: key, keys: [key] });
  }
  for (const element of policy.elements) {
    definitions.push({ id: element, keys: [element] });
    definitions.push({ id: `damage-${element}`, keys: [ELEMENT_DAMAGE[element]] });
  }
  return definitions;
}

function specialistValue(entry, definition) {
  return Math.max(0, ...definition.keys.map((key) => num(entry.optimisticStats, key)));
}

function addReason(reasons, id, reason) {
  const key = String(id);
  if (!reasons.has(key)) reasons.set(key, new Set());
  reasons.get(key).add(reason);
}

function reserveTop(profiles, getter, limit, selectedIds, reasons, reason) {
  const candidates = [...profiles]
    .filter((entry) => getter(entry) > 0)
    .sort((a, b) => getter(b) - getter(a) || b.rankScore - a.rankScore || String(a.item.id).localeCompare(String(b.item.id)))
    .slice(0, Math.max(0, Number(limit || 0)));
  for (const entry of candidates) {
    selectedIds.add(String(entry.item.id));
    addReason(reasons, entry.item.id, reason);
  }
  return candidates.length;
}

function profileIsContextRelevant(entry, policy) {
  if (!policy.targetElement) return true;
  const stats = entry.optimisticStats;
  if (targetElementSignal(stats, policy.targetElement) > 0) return true;
  if (genericOffenseSignal(stats) > 0) return true;
  if (constraintOrderingSignal(stats, policy.constraints) > 0) return true;
  if (entry.item?.setId || hasUniqueMechanic(entry.item)) return true;
  if (STRUCTURAL_SPECIALIST_KEYS.some((key) => num(stats, key) > 0)) return true;
  return policy.conditionKeys.some((key) => num(stats, key) > 0);
}

export function createCandidatePolicy({
  items = [],
  sets = [],
  selections = [],
  constraints = {},
  turnMode = 'sum',
  scenario = {},
  searchProfile = 'BALANCED',
  slotRules = SLOT_RULES
} = {}) {
  const profile = getSearchProfile(searchProfile);
  const elements = activeSpellElements(selections);
  const targetElement = elements.length === 1 ? elements[0] : null;
  const relevance = relevantStatKeys({ items, selections, constraints });
  const conditionInfo = collectConditionStatInfo(items);
  const paretoKeys = new Set([
    ...relevance.keys,
    ...STRUCTURAL_SPECIALIST_KEYS,
    ...GENERIC_OFFENSE_KEYS,
    'ap', 'mp', 'range'
  ]);
  for (const element of elements) {
    paretoKeys.add(element);
    paretoKeys.add(ELEMENT_DAMAGE[element]);
  }
  for (const key of positiveConstraintKeys(constraints)) paretoKeys.add(key);

  const baselineObjective = Number(evaluateObjectiveUpperBound({ stats: {}, selections, turnMode }).score || 0);
  const policy = {
    profile,
    items,
    sets,
    selections,
    constraints,
    turnMode,
    scenario,
    targetElement,
    elements,
    conditionKeys: [...conditionInfo.all].sort(),
    paretoKeys: [...paretoKeys].sort(),
    nonMonotoneKeys: relevance.nonMonotoneKeys,
    slotRules,
    rankStats(stats = {}) {
      const objective = Number(evaluateObjectiveUpperBound({ stats, selections, turnMode }).score || 0);
      const objectiveGain = Math.max(0, objective - baselineObjective);
      const constraintSignal = constraintOrderingSignal(stats, constraints);
      const targetSignal = targetElementSignal(stats, targetElement);
      const genericSignal = genericOffenseSignal(stats);
      const weights = profile.ranking;
      return {
        objective,
        objectiveGain,
        constraintSignal,
        targetSignal,
        genericSignal,
        rankScore: objectiveGain * weights.objectiveWeight
          + constraintSignal * weights.constraintWeight
          + targetSignal * weights.targetWeight
          + genericSignal * weights.genericWeight
      };
    },
    profileItem(item) {
      const optimistic = optimisticItemStats(item, { includePassives: true, turnMode, scenario });
      const ranked = this.rankStats(optimistic.stats);
      return {
        item,
        optimisticStats: optimistic.stats,
        bounded: optimistic.bounded,
        ...ranked
      };
    }
  };
  policy.setCoreHints = buildSetCoreHints(sets, items, policy, slotRules);
  return policy;
}

export function selectCandidatePoolForSlot({
  items = [],
  rule,
  policy,
  requiredItemIds = []
} = {}) {
  const slotItems = (items || []).filter((item) => item?.slot === rule.id);
  const allProfiles = slotItems.map((item) => policy.profileItem(item));
  const allProfileById = new Map(allProfiles.map((entry) => [String(entry.item.id), entry]));
  const reasons = new Map();
  const selectedIds = new Set();
  const specialistCounts = {};

  const eligibleProfiles = allProfiles.filter((entry) => profileIsContextRelevant(entry, policy));
  const eligibleItems = eligibleProfiles.map((entry) => entry.item);
  const eligibleProfileById = new Map(eligibleProfiles.map((entry) => [String(entry.item.id), entry]));
  const pareto = pruneDominatedCandidates(eligibleItems, {
    keys: policy.paretoKeys,
    nonMonotoneKeys: policy.nonMonotoneKeys,
    groupCount: Number(rule.count || 1)
  });
  const paretoIds = new Set(pareto.candidates.map((item) => String(item.id)));
  const paretoProfiles = eligibleProfiles.filter((entry) => paretoIds.has(String(entry.item.id)));
  for (const item of pareto.candidates) {
    selectedIds.add(String(item.id));
    addReason(reasons, item.id, 'pareto');
  }

  for (const key of positiveConstraintKeys(policy.constraints)) {
    const count = reserveTop(
      paretoProfiles,
      (entry) => Math.max(0, num(entry.optimisticStats, key)),
      policy.profile.candidate.constraintReservePerStat,
      selectedIds,
      reasons,
      `constraint:${key}`
    );
    if (count) specialistCounts[`constraint:${key}`] = count;
  }

  for (const definition of specialistDefinitions(policy)) {
    const count = reserveTop(
      paretoProfiles,
      (entry) => specialistValue(entry, definition),
      policy.profile.candidate.specialistReservePerCategory,
      selectedIds,
      reasons,
      `specialist:${definition.id}`
    );
    if (count) specialistCounts[definition.id] = count;
  }

  for (const entry of eligibleProfiles) {
    if (!hasUniqueMechanic(entry.item)) continue;
    selectedIds.add(String(entry.item.id));
    addReason(reasons, entry.item.id, 'specialist:unique-mechanic');
  }

  for (const plan of policy.setCoreHints) {
    let used = 0;
    for (const id of plan.memberIds) {
      const entry = eligibleProfileById.get(String(id));
      if (!entry || used >= policy.profile.candidate.setCoreReservePerPlan) continue;
      selectedIds.add(String(id));
      addReason(reasons, id, 'set-core');
      used++;
    }
  }

  const paretoRanked = [...paretoProfiles]
    .sort((a, b) => b.rankScore - a.rankScore || String(a.item.id).localeCompare(String(b.item.id)));
  for (const entry of paretoRanked.slice(0, policy.profile.candidate.offensiveRankReserve)) {
    selectedIds.add(String(entry.item.id));
    addReason(reasons, entry.item.id, 'offense-rank');
  }

  for (const id of requiredItemIds || []) {
    const entry = allProfileById.get(String(id));
    if (!entry) continue;
    selectedIds.add(String(id));
    addReason(reasons, id, 'required');
  }

  const target = Math.max(Number(rule.count || 1), Number(policy.profile.candidate.slotPoolTargets?.[rule.id] || rule.count || 1));
  const rankedEligible = [...eligibleProfiles]
    .sort((a, b) => b.rankScore - a.rankScore || String(a.item.id).localeCompare(String(b.item.id)));
  for (const entry of rankedEligible) {
    if (selectedIds.size >= target) break;
    selectedIds.add(String(entry.item.id));
    addReason(reasons, entry.item.id, 'rank-fill');
  }

  const selectedProfiles = allProfiles
    .filter((entry) => selectedIds.has(String(entry.item.id)))
    .sort((a, b) => b.rankScore - a.rankScore || String(a.item.id).localeCompare(String(b.item.id)));
  const reasonObject = Object.fromEntries([...reasons.entries()].map(([id, values]) => [id, [...values].sort()]));

  return {
    items: selectedProfiles.map((entry) => entry.item),
    profiles: selectedProfiles,
    reasons: reasonObject,
    diagnostics: {
      id: rule.id,
      count: Number(rule.count || 1),
      before: slotItems.length,
      afterLegality: eligibleProfiles.length,
      paretoKept: pareto.candidates.length,
      dominatedPareto: pareto.dominatedRemoved,
      equivalentPareto: pareto.equivalentRemoved,
      specialists: specialistCounts,
      setCore: selectedProfiles.filter((entry) => reasonObject[String(entry.item.id)]?.includes('set-core')).length,
      offensiveRanked: selectedProfiles.filter((entry) => reasonObject[String(entry.item.id)]?.includes('offense-rank')).length,
      target,
      protectedOverflow: Math.max(0, selectedProfiles.length - target),
      afterShortlist: selectedProfiles.length,
      poolFinal: selectedProfiles.length,
      reasons: reasonObject
    }
  };
}

export function buildCandidatePools({
  items = [],
  sets = [],
  selections = [],
  constraints = {},
  turnMode = 'sum',
  scenario = {},
  searchProfile = 'BALANCED',
  slotRules = SLOT_RULES,
  requiredItemIds = []
} = {}) {
  const policy = createCandidatePolicy({ items, sets, selections, constraints, turnMode, scenario, searchProfile, slotRules });
  const pools = {};
  const output = [];
  const slots = [];
  for (const rule of slotRules || SLOT_RULES) {
    const selected = selectCandidatePoolForSlot({ items, rule, policy, requiredItemIds });
    pools[rule.id] = selected.items;
    output.push(...selected.items);
    slots.push(selected.diagnostics);
  }

  return {
    items: output,
    pools,
    policy,
    diagnostics: {
      mode: policy.targetElement ? 'mono-element' : 'multi-element',
      targetElement: policy.targetElement,
      constrainedStats: positiveConstraintKeys(constraints),
      paretoDimensions: policy.paretoKeys,
      before: items.length,
      afterLevelFilter: items.length,
      after: output.length,
      relevantSets: policy.setCoreHints.length,
      topSetPlans: policy.setCoreHints.map((plan) => ({ ...plan, memberIds: [...plan.memberIds] })),
      slots
    }
  };
}

export function constraintProgressForStats(stats = {}, constraints = {}) {
  const keys = positiveConstraintKeys(constraints);
  if (!keys.length) return { ready: true, coverage: 0, missing: 0, signature: '' };
  let coverage = 0;
  let missing = 0;
  const signature = [];
  for (const key of keys) {
    const target = Math.max(1, Number(constraints[key] || 0));
    const actual = Math.max(0, num(stats, key));
    const ratio = Math.min(1, actual / target);
    coverage += ratio;
    missing += 1 - ratio;
    signature.push(`${key}:${Math.min(4, Math.floor(ratio * 4))}`);
  }
  return { ready: missing < 1e-9, coverage, missing, signature: signature.join(',') };
}
