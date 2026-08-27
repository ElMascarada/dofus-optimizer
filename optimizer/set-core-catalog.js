import { SLOT_RULES } from '../js/config.js';
import { countSetBonuses, specialSlotRulesAreValid } from '../js/build-legality.js';

export const SET_CORE_PIECE_COUNTS = Object.freeze([2, 3, 4]);
export const SET_CORE_SLOTS = Object.freeze([
  'hat', 'cape', 'amulet', 'ring', 'belt', 'boots', 'weapon', 'shield'
]);

const PROFILE_IDS = Object.freeze([
  'terre', 'feu', 'eau', 'air', 'multi', 'crit', 'do-crit',
  'initiative', 'vita', 'res', 'melee', 'distance', 'PA', 'PM', 'PO'
]);

const ELEMENT_STAT = Object.freeze({
  terre: 'earth',
  feu: 'fire',
  eau: 'water',
  air: 'air'
});

const ELEMENT_DAMAGE_STAT = Object.freeze({
  terre: 'damageEarth',
  feu: 'damageFire',
  eau: 'damageWater',
  air: 'damageAir'
});

const RESISTANCE_STATS = Object.freeze([
  'resNeutral', 'resEarth', 'resFire', 'resWater', 'resAir'
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

function slotCapacities(slotRules = SLOT_RULES) {
  return new Map((slotRules || SLOT_RULES).map((rule) => [rule.id, Math.max(0, Number(rule.count || 0))]));
}

function occupiedSlots(items = []) {
  const result = {};
  for (const item of items || []) result[item.slot] = Number(result[item.slot] || 0) + 1;
  return Object.fromEntries(Object.entries(result).sort(([a], [b]) => String(a).localeCompare(String(b))));
}

function slotSignature(value = {}) {
  return Object.entries(value)
    .sort(([a], [b]) => String(a).localeCompare(String(b)))
    .map(([slot, count]) => `${slot}:${count}`)
    .join('|');
}

function coreId(setId, pieceCount, items = []) {
  const members = items.map((item) => String(item.id)).sort().join('+');
  return `${setId}:${pieceCount}:${members}`;
}

function combinationKey(items = []) {
  return items.map((item) => String(item.id)).sort().join('|');
}

function combinationItems(items, count, capacities) {
  const output = [];
  const chosen = [];
  const usedSlots = new Map();

  function visit(start) {
    if (chosen.length === count) {
      output.push([...chosen]);
      return;
    }
    const remaining = count - chosen.length;
    for (let index = start; index <= items.length - remaining; index++) {
      const item = items[index];
      const capacity = capacities.get(item.slot) || 0;
      const used = usedSlots.get(item.slot) || 0;
      if (used >= capacity) continue;
      chosen.push(item);
      usedSlots.set(item.slot, used + 1);
      visit(index + 1);
      chosen.pop();
      if (used === 0) usedSlots.delete(item.slot);
      else usedSlots.set(item.slot, used);
    }
  }

  visit(0);
  return output;
}

function aggregateStaticStats(items = [], setBonus = {}) {
  const stats = {};
  for (const item of items) addStats(stats, item.stats || {});
  addStats(stats, setBonus || {});
  return stats;
}

function aggregateSearchStats(items = [], setBonus = {}, profileItem = null) {
  const stats = {};
  for (const item of items) {
    const profiled = typeof profileItem === 'function' ? profileItem(item) : null;
    addStats(stats, profiled?.optimisticStats || item.stats || {});
  }
  addStats(stats, setBonus || {});
  return stats;
}

function strengthLevel(score) {
  if (score >= 300) return 3;
  if (score >= 150) return 2;
  if (score >= 60) return 1;
  return 0;
}

function elementSignal(stats, profileId) {
  const stat = ELEMENT_STAT[profileId];
  const damage = ELEMENT_DAMAGE_STAT[profileId];
  return Math.max(0, num(stats, stat))
    + Math.max(0, num(stats, 'power'))
    + Math.max(0, num(stats, damage)) * 8
    + Math.max(0, num(stats, 'damage')) * 5;
}

export function profileSetCore(stats = {}) {
  const elements = Object.fromEntries(Object.keys(ELEMENT_STAT).map((id) => [id, elementSignal(stats, id)]));
  const elementOnly = Object.keys(ELEMENT_STAT)
    .map((id) => Math.max(0, num(stats, ELEMENT_STAT[id])) + Math.max(0, num(stats, ELEMENT_DAMAGE_STAT[id])) * 8)
    .sort((a, b) => b - a);

  const scores = {
    ...elements,
    multi: Math.max(0, num(stats, 'power'))
      + Number(elementOnly[1] || 0)
      + Number(elementOnly[2] || 0) * 0.5,
    crit: Math.max(0, num(stats, 'crit')) * 14 + Math.max(0, num(stats, 'critDamage')) * 0.8,
    'do-crit': Math.max(0, num(stats, 'critDamage')) * 5 + Math.max(0, num(stats, 'crit')) * 3,
    initiative: Math.max(0, num(stats, 'initiative')) / 4,
    vita: Math.max(0, num(stats, 'vit')) / 3,
    res: RESISTANCE_STATS.reduce((sum, key) => sum + Math.max(0, num(stats, key)) * 12, 0),
    melee: Math.max(0, num(stats, 'meleeDamagePct')) * 20,
    distance: Math.max(0, num(stats, 'rangedDamagePct')) * 20,
    PA: Math.max(0, num(stats, 'ap')) * 400,
    PM: Math.max(0, num(stats, 'mp')) * 400,
    PO: Math.max(0, num(stats, 'range')) * 250
  };

  const strengths = Object.fromEntries(PROFILE_IDS.map((id) => {
    const score = Math.round(Number(scores[id] || 0) * 1000) / 1000;
    return [id, { score, level: strengthLevel(score) }];
  }));
  const tags = PROFILE_IDS
    .filter((id) => strengths[id].level > 0)
    .sort((a, b) => strengths[b].level - strengths[a].level
      || strengths[b].score - strengths[a].score
      || a.localeCompare(b));

  return { tags, strengths };
}

function compareLeaf(node, actual) {
  if (node.operator === 'eq') return actual === Number(node.value);
  if (node.operator === 'neq') return actual !== Number(node.value);
  if (node.operator === 'gt') return actual > Number(node.value);
  if (node.operator === 'gte') return actual >= Number(node.value);
  if (node.operator === 'lt') return actual < Number(node.value);
  if (node.operator === 'lte') return actual <= Number(node.value);
  return false;
}

function monotoneConditionStatus(node, context = {}) {
  if (!node) return 'satisfied';
  if (node.kind === 'relation') {
    const children = (node.children || []).map((child) => monotoneConditionStatus(child, context));
    if (node.relation === 'and') {
      if (children.includes('impossible')) return 'impossible';
      if (children.every((status) => status === 'satisfied')) return 'satisfied';
      return 'deferred';
    }
    if (node.relation === 'or') {
      if (children.includes('satisfied')) return 'satisfied';
      if (children.every((status) => status === 'impossible')) return 'impossible';
      return 'deferred';
    }
    return 'deferred';
  }

  if (node.stat === 'level') {
    return compareLeaf(node, Number(context.level || 200)) ? 'satisfied' : 'impossible';
  }
  if (node.stat !== 'setBonus') return 'deferred';

  const actual = Number(context.setBonus || 0);
  const target = Number(node.value || 0);
  if (node.operator === 'lt' && actual >= target) return 'impossible';
  if (node.operator === 'lte' && actual > target) return 'impossible';
  if (node.operator === 'eq' && actual > target) return 'impossible';
  if (node.operator === 'gt' || node.operator === 'gte') {
    return compareLeaf(node, actual) ? 'satisfied' : 'deferred';
  }
  if (node.operator === 'eq') return actual === target ? 'deferred' : 'deferred';
  if (node.operator === 'neq') return 'deferred';
  if (node.operator === 'lt' || node.operator === 'lte') return 'deferred';
  return 'deferred';
}

function conditionsStatus(items = []) {
  const context = { level: 200, setBonus: countSetBonuses(items) };
  const statuses = items
    .filter((item) => item?.conditions)
    .map((item) => monotoneConditionStatus(item.conditions, context));
  if (!statuses.length) return 'satisfied';
  if (statuses.includes('impossible')) return 'impossible';
  if (statuses.every((status) => status === 'satisfied')) return 'satisfied';
  return 'deferred';
}

function structuralLegality(items, capacities) {
  const slots = occupiedSlots(items);
  for (const [slot, count] of Object.entries(slots)) {
    if (count > Number(capacities.get(slot) || 0)) return { valid: false, reason: `slot:${slot}` };
  }
  if (!specialSlotRulesAreValid(items)) return { valid: false, reason: 'special-slot-rule' };
  return { valid: true, reason: null };
}

function dominanceSafe(items = []) {
  return items.every((item) => !item?.conditions
    && !(item?.passives || []).length
    && !(item?.effects || []).length
    && !Object.keys(item?.turnBonuses || {}).length
    && !(item?.pendingDynamicEffects || []).length
    && item?.certified !== false);
}

function statsDominate(a = {}, b = {}) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  let strict = false;
  for (const key of keys) {
    const av = num(a, key);
    const bv = num(b, key);
    if (av + 1e-9 < bv) return false;
    if (av > bv + 1e-9) strict = true;
  }
  return strict;
}

function pruneDominatedCores(cores = []) {
  const grouped = new Map();
  for (const core of cores) {
    const key = `${core.setId}:${core.pieceCount}:${slotSignature(core.occupiedSlots)}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(core);
  }

  const dominated = new Set();
  for (const group of grouped.values()) {
    for (let i = 0; i < group.length; i++) {
      const candidate = group[i];
      if (!candidate.dominanceSafe || dominated.has(candidate.id)) continue;
      for (let j = 0; j < group.length; j++) {
        if (i === j) continue;
        const challenger = group[j];
        if (!challenger.dominanceSafe) continue;
        if (statsDominate(challenger.aggregateStats, candidate.aggregateStats)) {
          dominated.add(candidate.id);
          break;
        }
      }
    }
  }

  return {
    cores: cores.filter((core) => !dominated.has(core.id)),
    dominatedIds: [...dominated].sort()
  };
}

function freezeCore(core) {
  Object.freeze(core.items);
  Object.freeze(core.occupiedSlots);
  Object.freeze(core.setBonuses);
  Object.freeze(core.aggregateStats);
  Object.freeze(core.searchStats);
  Object.freeze(core.tags);
  Object.freeze(core.profile.strengths);
  Object.freeze(core.profile);
  Object.freeze(core.legality.reasons);
  Object.freeze(core.legality);
  return Object.freeze(core);
}

export class SetCoreCatalog {
  constructor({ cores = [], diagnostics = {}, slotRules = SLOT_RULES } = {}) {
    this.cores = Object.freeze(cores.map(freezeCore));
    this.diagnostics = Object.freeze({ ...diagnostics });
    this.slotRules = Object.freeze([...(slotRules || SLOT_RULES)]);
    this.byId = new Map(this.cores.map((core) => [core.id, core]));
    this.bySet = new Map();
    for (const core of this.cores) {
      if (!this.bySet.has(core.setId)) this.bySet.set(core.setId, []);
      this.bySet.get(core.setId).push(core);
    }
  }

  get(id) {
    return this.byId.get(String(id)) || null;
  }

  forSet(setId) {
    return [...(this.bySet.get(setId) || [])];
  }

  compatible(first, second) {
    const a = typeof first === 'string' ? this.get(first) : first;
    const b = typeof second === 'string' ? this.get(second) : second;
    return areSetCoresCompatible(a, b, this.slotRules);
  }
}

export function buildSetCoreCatalog({
  items = [],
  sets = [],
  slotRules = SLOT_RULES,
  pieceCounts = SET_CORE_PIECE_COUNTS,
  minLevel = 190,
  maxLevel = 200,
  profileItem = null
} = {}) {
  const capacities = slotCapacities(slotRules);
  const allowedSlots = new Set(SET_CORE_SLOTS.filter((slot) => (capacities.get(slot) || 0) > 0));
  const setIds = new Set((sets || []).map((set) => set.id));
  const eligible = (items || []).filter((item) => item?.setId
    && setIds.has(item.setId)
    && allowedSlots.has(item.slot)
    && Number(item.level || 0) >= Number(minLevel || 0)
    && Number(item.level || 0) <= Number(maxLevel || Infinity));

  const bySet = new Map();
  for (const item of eligible) {
    if (!bySet.has(item.setId)) bySet.set(item.setId, []);
    bySet.get(item.setId).push(item);
  }

  const generated = [];
  let illegal = 0;
  const illegalReasons = {};
  for (const set of sets || []) {
    const members = bySet.get(set.id) || [];
    if (!members.length) continue;
    for (const rawCount of pieceCounts || SET_CORE_PIECE_COUNTS) {
      const pieceCount = Number(rawCount);
      if (!Number.isInteger(pieceCount) || pieceCount < 2 || pieceCount > 4) continue;
      const setBonus = set?.bonuses?.[String(pieceCount)];
      if (!setBonus || members.length < pieceCount) continue;
      for (const selected of combinationItems(members, pieceCount, capacities)) {
        const structural = structuralLegality(selected, capacities);
        const conditionStatus = structural.valid ? conditionsStatus(selected) : 'impossible';
        const reasons = [];
        if (!structural.valid) reasons.push(structural.reason);
        if (conditionStatus === 'impossible') reasons.push('item-condition');
        const legality = {
          valid: structural.valid && conditionStatus !== 'impossible',
          structural: structural.valid,
          conditions: conditionStatus,
          requiresFinalBuildValidation: conditionStatus === 'deferred',
          reasons
        };
        if (!legality.valid) {
          illegal++;
          for (const reason of reasons) illegalReasons[reason] = Number(illegalReasons[reason] || 0) + 1;
          continue;
        }

        const aggregateStats = aggregateStaticStats(selected, setBonus);
        const searchStats = aggregateSearchStats(selected, setBonus, profileItem);
        const profile = profileSetCore(aggregateStats);
        generated.push({
          id: coreId(set.id, pieceCount, selected),
          setId: set.id,
          setName: set.name || String(set.id),
          items: [...selected],
          itemIds: selected.map((item) => String(item.id)).sort(),
          occupiedSlots: occupiedSlots(selected),
          pieceCount,
          setBonuses: { ...(setBonus || {}) },
          aggregateStats,
          searchStats,
          tags: [...profile.tags],
          profile,
          legality,
          dominanceSafe: dominanceSafe(selected)
        });
      }
    }
  }

  const generatedBeforeDominance = generated.length;
  const pruned = pruneDominatedCores(generated);
  pruned.cores.sort((a, b) => String(a.setName).localeCompare(String(b.setName))
    || a.pieceCount - b.pieceCount
    || combinationKey(a.items).localeCompare(combinationKey(b.items)));

  return new SetCoreCatalog({
    cores: pruned.cores,
    slotRules,
    diagnostics: {
      setCount: (sets || []).length,
      eligibleSetCount: bySet.size,
      eligibleItemCount: eligible.length,
      generated: generatedBeforeDominance + illegal,
      legalGenerated: generatedBeforeDominance,
      eliminatedLegality: illegal,
      eliminatedDominance: pruned.dominatedIds.length,
      eliminated: illegal + pruned.dominatedIds.length,
      retained: pruned.cores.length,
      illegalReasons
    }
  });
}

function positiveConstraintEntries(constraints = {}) {
  return Object.entries(constraints || {})
    .filter(([, value]) => Number.isFinite(Number(value)) && Number(value) > 0);
}

function elementProfileId(targetElement) {
  if (targetElement === 'earth') return 'terre';
  if (targetElement === 'fire') return 'feu';
  if (targetElement === 'water') return 'eau';
  if (targetElement === 'air') return 'air';
  return null;
}

function whySelected(core, policy, aggregateRank, bonusRank) {
  const reasons = [];
  const targetProfile = elementProfileId(policy.targetElement);
  if (targetProfile && Number(core.profile.strengths?.[targetProfile]?.level || 0) > 0) {
    reasons.push(`high ${policy.targetElement} damage`);
  }
  if (Number(core.profile.strengths?.crit?.level || 0) > 0
    || Number(core.profile.strengths?.['do-crit']?.level || 0) > 0) {
    reasons.push('critical synergy');
  }
  if (Number(bonusRank?.objectiveGain || 0) > 0
    || ['ap', 'mp', 'range'].some((key) => num(core.setBonuses, key) > 0)) {
    reasons.push('useful set bonus');
  }
  for (const [key] of positiveConstraintEntries(policy.constraints)) {
    if (num(core.searchStats, key) > 0) reasons.push(`helps ${key} constraint`);
  }
  if (!reasons.length && Number(aggregateRank?.objectiveGain || 0) > 0) reasons.push('combined offensive value');
  if (!reasons.length) reasons.push('structural set synergy');
  return [...new Set(reasons)].slice(0, 5);
}

export function rankSetCoresForPolicy(catalog, policy, { limit = Infinity } = {}) {
  const cores = catalog?.cores || [];
  const ranked = [];
  for (const core of cores) {
    if (!core?.legality?.valid) continue;
    const aggregateRank = policy.rankStats(core.searchStats || core.aggregateStats || {});
    const bonusRank = policy.rankStats(core.setBonuses || {});
    const helpsConstraint = positiveConstraintEntries(policy.constraints)
      .some(([key]) => num(core.searchStats, key) > 0);
    const structural = ['ap', 'mp', 'range'].some((key) => num(core.searchStats, key) > 0);
    const relevant = Number(aggregateRank.objectiveGain || 0) > 0
      || Number(aggregateRank.constraintSignal || 0) > 0
      || Number(bonusRank.objectiveGain || 0) > 0
      || helpsConstraint
      || structural;
    if (!relevant) continue;

    const planning = policy.profile?.setPlanning || {};
    const activation = Number(planning.activationWeight || 0);
    const pieceWeight = Number(planning.pieceCountWeight || 0) * Number(core.pieceCount || 0);
    const bonusWeight = Number(planning.bonusRankWeight ?? 0.8);
    const resourcePayoff = Math.max(0, num(core.setBonuses, 'ap')) * Number(planning.apBonusWeight || 0)
      + Math.max(0, num(core.setBonuses, 'mp')) * Number(planning.mpBonusWeight || 0);
    const searchScore = Number(aggregateRank.rankScore || 0)
      + Number(bonusRank.rankScore || 0) * bonusWeight
      + activation + pieceWeight + resourcePayoff;
    ranked.push({
      ...core,
      searchScore,
      aggregateRank,
      bonusRank,
      whySelected: whySelected(core, policy, aggregateRank, bonusRank)
    });
  }

  ranked.sort((a, b) => b.searchScore - a.searchScore
    || b.pieceCount - a.pieceCount
    || String(a.id).localeCompare(String(b.id)));
  const normalizedLimit = Number.isFinite(Number(limit)) ? Math.max(0, Number(limit)) : ranked.length;
  const selected = ranked.slice(0, normalizedLimit);
  return {
    selected,
    relevantCount: ranked.length,
    diagnostics: {
      ...(catalog?.diagnostics || {}),
      relevant: ranked.length,
      injected: selected.length
    }
  };
}

export function areSetCoresCompatible(first, second, slotRules = SLOT_RULES) {
  if (!first || !second) return { compatible: false, reasons: ['missing-core'], conditions: 'impossible' };
  const reasons = [];
  if (first.id === second.id) reasons.push('same-core');
  if (first.setId === second.setId) reasons.push('same-set');

  const firstIds = new Set((first.items || []).map((item) => String(item.id)));
  if ((second.items || []).some((item) => firstIds.has(String(item.id)))) reasons.push('duplicate-item');

  const items = [...(first.items || []), ...(second.items || [])];
  const capacities = slotCapacities(slotRules);
  const structural = structuralLegality(items, capacities);
  if (!structural.valid) reasons.push(structural.reason);
  const conditionStatus = conditionsStatus(items);
  if (conditionStatus === 'impossible') reasons.push('item-condition');

  return {
    compatible: reasons.length === 0,
    reasons: [...new Set(reasons)],
    occupiedSlots: occupiedSlots(items),
    conditions: conditionStatus,
    requiresFinalBuildValidation: conditionStatus === 'deferred'
  };
}
