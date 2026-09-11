import { BASE_CHARACTER, SLOT_RULES } from '../js/config.js';
import { collectConditionStatInfo, pruneDominatedCandidates } from '../js/search-space.js';
import { effectiveStat } from '../js/stats.js';
import { evaluateSyntheticOffense, SYNTHETIC_COMMON_STAT_KEYS } from '../js/synthetic-offense.js';
import { getSearchProfile } from './search-profiles.js';
import { buildSetCoreCatalog, rankSetCoresForPolicy } from './set-core-catalog.js';

const ELEMENTS = Object.freeze(['earth', 'fire', 'water', 'air']);
const ELEMENT_DAMAGE = Object.freeze({
  earth: 'damageEarth',
  fire: 'damageFire',
  water: 'damageWater',
  air: 'damageAir'
});
const STRUCTURAL_KEYS = Object.freeze(['ap', 'mp', 'range']);

function num(stats, key) {
  const value = Number(stats?.[key] || 0);
  return Number.isFinite(value) ? value : 0;
}

function positiveStats(stats = {}) {
  const output = {};
  for (const [key, raw] of Object.entries(stats || {})) {
    const value = Number(raw);
    if (Number.isFinite(value) && value > 0) output[key] = value;
  }
  return output;
}

export function positiveEquipmentConstraintKeys(constraints = {}) {
  return Object.entries(constraints || {})
    .filter(([, minimum]) => Number.isFinite(Number(minimum)) && Number(minimum) > 0)
    .map(([key]) => key)
    .sort();
}

function normalizeSyntheticElements(elements = []) {
  const normalized = [...new Set((Array.isArray(elements) ? elements : [elements])
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean))];
  if (normalized.includes('multi')) return ['multi'];
  return normalized.filter((element) => ELEMENTS.includes(element));
}

export function syntheticRelevantStatKeys(syntheticOffense = {}) {
  const requested = normalizeSyntheticElements(syntheticOffense?.elements);
  const keys = new Set([...SYNTHETIC_COMMON_STAT_KEYS, 'ap']);
  const elements = requested.includes('multi') ? ELEMENTS : requested;
  for (const element of elements) {
    keys.add(element);
    keys.add(ELEMENT_DAMAGE[element]);
  }
  return [...keys].sort();
}

function constraintSignal(stats, constraints = {}) {
  let signal = 0;
  for (const key of positiveEquipmentConstraintKeys(constraints)) {
    const target = Math.max(1, Number(constraints[key] || 0));
    signal += Math.min(1, Math.max(0, effectiveStat(stats, key)) / target);
  }
  return signal;
}

function estimatedAp(stats = {}, fmPolicy = {}) {
  const base = Number(BASE_CHARACTER.baseStats?.ap || 0);
  const globalFm = fmPolicy?.enabled === true || fmPolicy?.fmEnabled === true;
  const exo = globalFm || Number(fmPolicy?.exoAp) === 1 ? 1 : 0;
  return Math.max(0, Math.min(12, base + exo + num(stats, 'ap')));
}

function addReason(reasons, id, reason) {
  const key = String(id);
  if (!reasons.has(key)) reasons.set(key, new Set());
  reasons.get(key).add(reason);
}

function reserveTop(profiles, getter, limit, selectedIds, reasons, reason) {
  const candidates = [...profiles]
    .filter((entry) => getter(entry) > 0)
    .sort((a, b) => getter(b) - getter(a)
      || b.rankScore - a.rankScore
      || String(a.item.id).localeCompare(String(b.item.id)))
    .slice(0, Math.max(0, Number(limit || 0)));
  for (const entry of candidates) {
    selectedIds.add(String(entry.item.id));
    addReason(reasons, entry.item.id, reason);
  }
  return candidates.length;
}

function setCoreHint(core, policy) {
  return {
    coreId: core.id,
    setId: core.setId,
    name: core.setName,
    targetCount: core.pieceCount,
    score: Number(core.searchScore || 0),
    memberIds: [...core.itemIds],
    memberScores: core.items.map((item) => Number(policy.profileItem(item).rankScore || 0)),
    bonus: { ...core.setBonuses },
    aggregateStats: { ...core.aggregateStats },
    tags: [...core.tags],
    whySelected: [...(core.whySelected || [])]
  };
}

export function createEquipmentCandidatePolicy({
  items = [],
  sets = [],
  constraints = {},
  fmPolicy = {},
  syntheticOffense = {},
  searchProfile = 'BALANCED',
  slotRules = SLOT_RULES
} = {}) {
  const profile = getSearchProfile(searchProfile);
  const requestedElements = normalizeSyntheticElements(syntheticOffense?.elements);
  const offenseKeys = syntheticRelevantStatKeys(syntheticOffense);
  const conditionInfo = collectConditionStatInfo(items);
  const constraintKeys = positiveEquipmentConstraintKeys(constraints);
  const initiativeRelevant = constraintKeys.includes('initiative') || conditionInfo.all.has('initiative');
  const paretoKeys = new Set([...offenseKeys, ...constraintKeys, ...conditionInfo.all, ...STRUCTURAL_KEYS]);
  if (initiativeRelevant) for (const element of ELEMENTS) paretoKeys.add(element);

  const baselineStats = {};
  const baselineAp = estimatedAp(baselineStats, fmPolicy);
  const baselineOffense = evaluateSyntheticOffense({
    stats: baselineStats,
    availableAp: baselineAp,
    elements: syntheticOffense?.elements,
    profiles: syntheticOffense?.profiles,
    critMode: syntheticOffense?.critMode
  });

  const policy = {
    profile,
    items,
    sets,
    constraints,
    fmPolicy,
    syntheticOffense,
    elements: requestedElements,
    targetElement: requestedElements.length === 1 && requestedElements[0] !== 'multi' ? requestedElements[0] : null,
    conditionKeys: [...conditionInfo.all].sort(),
    nonMonotoneKeys: conditionInfo.nonMonotone,
    offenseKeys,
    paretoKeys: [...paretoKeys].filter((key) => key !== 'level' && key !== 'setBonus').sort(),
    slotRules,
    rankStats(stats = {}) {
      const availableAp = estimatedAp(stats, fmPolicy);
      const offense = evaluateSyntheticOffense({
        stats,
        availableAp,
        elements: syntheticOffense?.elements,
        profiles: syntheticOffense?.profiles,
        critMode: syntheticOffense?.critMode
      });
      const objectiveGain = Math.max(0, Number(offense.minimumScore) - Number(baselineOffense.minimumScore));
      const meanGain = Math.max(0, Number(offense.meanScore) - Number(baselineOffense.meanScore));
      const constraintProgress = constraintSignal(stats, constraints);
      const weights = profile.ranking;
      return {
        objective: offense.minimumScore,
        objectiveGain,
        meanObjective: offense.meanScore,
        meanGain,
        constraintSignal: constraintProgress,
        targetSignal: 0,
        genericSignal: meanGain,
        rankScore: objectiveGain * Number(weights.objectiveWeight || 0)
          + meanGain * 10
          + constraintProgress * Number(weights.constraintWeight || 0),
        syntheticOffense: offense,
        estimatedAp: availableAp
      };
    },
    profileItem(item) {
      const optimisticStats = positiveStats(item?.stats || {});
      return {
        item,
        optimisticStats,
        bounded: true,
        ...this.rankStats(optimisticStats)
      };
    }
  };

  policy.setCoreCatalog = buildSetCoreCatalog({
    items,
    sets,
    slotRules,
    profileItem: (item) => policy.profileItem(item)
  });
  const setCoreSelection = rankSetCoresForPolicy(policy.setCoreCatalog, policy, {
    limit: profile.candidate.maxSetCorePlans
  });
  policy.setCoreSelectionDiagnostics = setCoreSelection.diagnostics;
  policy.setCoreHints = setCoreSelection.selected.map((core) => setCoreHint(core, policy));
  return policy;
}

export function selectEquipmentCandidatePoolForSlot({
  items = [],
  rule,
  policy,
  requiredItemIds = []
} = {}) {
  const slotItems = (items || []).filter((item) => item?.slot === rule.id);
  const profiles = slotItems.map((item) => policy.profileItem(item));
  const profileById = new Map(profiles.map((entry) => [String(entry.item.id), entry]));
  const reasons = new Map();
  const selectedIds = new Set();

  const pareto = pruneDominatedCandidates(slotItems, {
    keys: policy.paretoKeys,
    nonMonotoneKeys: policy.nonMonotoneKeys,
    groupCount: Number(rule.count || 1)
  });
  const paretoIds = new Set(pareto.candidates.map((item) => String(item.id)));
  const paretoProfiles = profiles.filter((entry) => paretoIds.has(String(entry.item.id)));
  for (const entry of paretoProfiles) {
    selectedIds.add(String(entry.item.id));
    addReason(reasons, entry.item.id, 'pareto');
  }

  const specialistKeys = [...new Set([
    ...policy.offenseKeys,
    ...positiveEquipmentConstraintKeys(policy.constraints),
    ...policy.conditionKeys,
    'ap', 'mp', 'range'
  ])];
  for (const key of specialistKeys) {
    reserveTop(
      paretoProfiles,
      (entry) => Math.max(0, effectiveStat(entry.optimisticStats, key)),
      policy.profile.candidate.specialistReservePerCategory,
      selectedIds,
      reasons,
      `specialist:${key}`
    );
  }

  for (const plan of policy.setCoreHints || []) {
    let used = 0;
    for (const id of plan.memberIds) {
      const entry = profileById.get(String(id));
      if (!entry || used >= policy.profile.candidate.setCoreReservePerPlan) continue;
      selectedIds.add(String(id));
      addReason(reasons, id, 'set-core');
      used++;
    }
  }

  for (const id of requiredItemIds || []) {
    const entry = profileById.get(String(id));
    if (!entry) continue;
    selectedIds.add(String(id));
    addReason(reasons, id, 'required');
  }

  const target = Math.max(
    Number(rule.count || 1),
    Number(policy.profile.candidate.slotPoolTargets?.[rule.id] || rule.count || 1)
  );
  const ranked = [...profiles].sort((a, b) => b.rankScore - a.rankScore
    || String(a.item.id).localeCompare(String(b.item.id)));
  for (const entry of ranked) {
    if (selectedIds.size >= target) break;
    selectedIds.add(String(entry.item.id));
    addReason(reasons, entry.item.id, 'rank-fill');
  }

  const selected = profiles
    .filter((entry) => selectedIds.has(String(entry.item.id)))
    .sort((a, b) => b.rankScore - a.rankScore || String(a.item.id).localeCompare(String(b.item.id)));
  const reasonObject = Object.fromEntries([...reasons.entries()]
    .map(([id, values]) => [id, [...values].sort()]));
  return {
    items: selected.map((entry) => entry.item),
    profiles: selected,
    reasons: reasonObject,
    diagnostics: {
      id: rule.id,
      count: Number(rule.count || 1),
      before: slotItems.length,
      paretoKept: pareto.candidates.length,
      dominatedPareto: pareto.dominatedRemoved,
      equivalentPareto: pareto.equivalentRemoved,
      target,
      afterShortlist: selected.length,
      reasons: reasonObject
    }
  };
}

export function buildEquipmentCandidatePools({
  items = [],
  sets = [],
  constraints = {},
  fmPolicy = {},
  syntheticOffense = {},
  searchProfile = 'BALANCED',
  slotRules = SLOT_RULES,
  requiredItemIds = []
} = {}) {
  const policy = createEquipmentCandidatePolicy({
    items,
    sets,
    constraints,
    fmPolicy,
    syntheticOffense,
    searchProfile,
    slotRules
  });
  const pools = {};
  const output = [];
  const slots = [];
  for (const rule of slotRules || SLOT_RULES) {
    const selected = selectEquipmentCandidatePoolForSlot({ items, rule, policy, requiredItemIds });
    pools[rule.id] = selected.items;
    output.push(...selected.items);
    slots.push(selected.diagnostics);
  }
  return {
    items: output,
    pools,
    policy,
    diagnostics: {
      mode: 'equipment-first',
      syntheticElements: [...policy.elements],
      constrainedStats: positiveEquipmentConstraintKeys(constraints),
      paretoDimensions: [...policy.paretoKeys],
      before: items.length,
      after: output.length,
      relevantCores: Number(policy.setCoreSelectionDiagnostics?.relevant || 0),
      injectedCores: policy.setCoreHints.length,
      slots
    }
  };
}
