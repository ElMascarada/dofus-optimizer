import { SLOT_RULES } from './config.js';
import { createCandidatePolicy } from '../optimizer/candidate-policy.js';
import { getSearchProfile } from '../optimizer/search-profiles.js';

const ENDGAME_SET_SLOTS = new Set([
  'hat', 'cape', 'amulet', 'ring', 'belt', 'boots', 'weapon', 'shield'
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
  return new Map((slotRules || SLOT_RULES).map((rule) => [rule.id, Number(rule.count || 0)]));
}

function chooseMembers(profiles, count, capacities) {
  const selected = [];
  const usedBySlot = new Map();
  const sorted = [...profiles].sort((a, b) => b.rankScore - a.rankScore || String(a.item.id).localeCompare(String(b.item.id)));
  for (const entry of sorted) {
    const slot = entry.item.slot;
    const used = usedBySlot.get(slot) || 0;
    if (used >= (capacities.get(slot) || 0)) continue;
    selected.push(entry);
    usedBySlot.set(slot, used + 1);
    if (selected.length >= count) break;
  }
  return selected;
}

function planKey(plan) {
  return `${plan.setId}:${plan.targetCount}`;
}

function architectureKey(plans) {
  return plans.map(planKey).sort().join('|');
}

function architectureCompatible(plans, itemById, capacities) {
  const setIds = new Set();
  const itemIds = new Set();
  const slots = new Map();
  for (const plan of plans) {
    if (setIds.has(plan.setId)) return false;
    setIds.add(plan.setId);
    for (const rawId of plan.memberIds || []) {
      const id = String(rawId);
      if (itemIds.has(id)) continue;
      const item = itemById.get(id);
      if (!item) return false;
      itemIds.add(id);
      const next = (slots.get(item.slot) || 0) + 1;
      if (next > (capacities.get(item.slot) || 0)) return false;
      slots.set(item.slot, next);
    }
  }
  const setSlotCapacity = [...ENDGAME_SET_SLOTS].reduce((sum, slot) => sum + Number(capacities.get(slot) || 0), 0);
  return itemIds.size <= setSlotCapacity;
}

function structureBonus(plans, profile) {
  const counts = plans.map((plan) => Number(plan.targetCount || 0)).sort((a, b) => b - a);
  let score = 0;
  for (const count of counts) {
    if (count >= 4) score += profile.setPlanning.largeSetBonus + count * profile.setPlanning.pieceCountWeight;
    else if (count === 3) score += profile.setPlanning.activationWeight + count * profile.setPlanning.pieceCountWeight;
    else if (count === 2) score += profile.setPlanning.activationWeight;
  }
  if (counts.join(',') === '3,3,3') score += profile.setPlanning.threeThreeThreeBonus;
  if (counts.join(',') === '3,2,2,2') score += profile.setPlanning.threeTwoTwoTwoBonus;
  return score;
}

function buildArchitectures(plans, items, slotRules, maxArchitectures, profile) {
  const itemById = new Map(items.map((item) => [String(item.id), item]));
  const capacities = slotCapacities(slotRules);
  const architectures = new Map();

  function add(combo) {
    if (!combo.length || !architectureCompatible(combo, itemById, capacities)) return;
    const key = architectureKey(combo);
    if (architectures.has(key)) return;
    architectures.set(key, {
      key,
      plans: [...combo],
      score: combo.reduce((sum, plan) => sum + Number(plan.score || 0), 0) + structureBonus(combo, profile),
      pieceCount: new Set(combo.flatMap((plan) => plan.memberIds || []).map(String)).size
    });
  }

  function visit(start, size, combo) {
    if (combo.length === size) {
      add(combo);
      return;
    }
    for (let index = start; index < plans.length; index++) {
      combo.push(plans[index]);
      if (architectureCompatible(combo, itemById, capacities)) visit(index + 1, size, combo);
      combo.pop();
    }
  }

  for (const plan of plans) add([plan]);
  const maxCombo = Math.min(4, plans.length);
  for (let size = 2; size <= maxCombo; size++) visit(0, size, []);

  const all = [...architectures.values()].sort((a, b) => b.score - a.score || b.pieceCount - a.pieceCount);
  if (!plans.length) return [];
  const primarySetId = plans[0].setId;
  const primary = all
    .filter((architecture) => architecture.plans.some((plan) => plan.setId === primarySetId))
    .sort((a, b) => a.plans.length - b.plans.length || b.score - a.score);
  const rest = all.filter((architecture) => !architecture.plans.some((plan) => plan.setId === primarySetId));

  const ordered = [];
  const seen = new Set();
  for (const architecture of [...primary, ...rest]) {
    if (seen.has(architecture.key)) continue;
    seen.add(architecture.key);
    ordered.push(architecture);
    if (ordered.length >= maxArchitectures) break;
  }
  return ordered;
}

export function buildSetSynergyIndex({
  items = [],
  sets = [],
  selections = [],
  constraints = {},
  turnMode = 'sum',
  scenario = {},
  slotRules = SLOT_RULES,
  maxPlans = null,
  maxArchitectures = null,
  policy = null,
  searchProfile = 'BALANCED'
} = {}) {
  const profile = getSearchProfile(searchProfile);
  const candidatePolicy = policy || createCandidatePolicy({
    items,
    sets,
    selections,
    constraints,
    turnMode,
    scenario,
    slotRules,
    searchProfile: profile
  });

  const eligible = items.filter((item) => {
    if (!item?.setId || !ENDGAME_SET_SLOTS.has(item.slot)) return false;
    const level = Number(item.level || 0);
    return level >= 190 && level <= 200;
  });

  const bySet = new Map();
  for (const item of eligible) {
    if (!bySet.has(item.setId)) bySet.set(item.setId, []);
    bySet.get(item.setId).push(candidatePolicy.profileItem(item));
  }

  const capacities = slotCapacities(slotRules);
  const allPlans = [];
  for (const set of sets || []) {
    const profiles = bySet.get(set.id) || [];
    if (!profiles.length) continue;
    for (const [countText, bonus] of Object.entries(set.bonuses || {})) {
      const count = Number(countText);
      if (!Number.isInteger(count) || count < 2) continue;
      const members = chooseMembers(profiles, count, capacities);
      if (members.length < count) continue;

      const combined = {};
      for (const member of members) addStats(combined, member.optimisticStats);
      addStats(combined, bonus);
      const combinedRank = candidatePolicy.rankStats(combined);
      const bonusRank = candidatePolicy.rankStats(bonus || {});
      const relevant = combinedRank.objectiveGain > 0
        || combinedRank.constraintSignal > 0
        || num(combined, 'ap') > 0
        || num(combined, 'mp') > 0
        || num(combined, 'range') > 0;
      if (!relevant) continue;

      const structural = profile.setPlanning.activationWeight + count * profile.setPlanning.pieceCountWeight;
      const payoff = Math.max(0, num(bonus, 'ap')) * profile.setPlanning.apBonusWeight
        + Math.max(0, num(bonus, 'mp')) * profile.setPlanning.mpBonusWeight;
      allPlans.push({
        setId: set.id,
        name: set.name || set.id,
        targetCount: count,
        memberIds: members.map((member) => String(member.item.id)),
        memberScores: members.map((member) => Number(member.rankScore || 0)),
        bonus: { ...(bonus || {}) },
        score: combinedRank.rankScore + bonusRank.rankScore * profile.setPlanning.bonusRankWeight + structural + payoff
      });
    }
  }

  const grouped = new Map();
  for (const plan of allPlans) {
    if (!grouped.has(plan.setId)) grouped.set(plan.setId, []);
    grouped.get(plan.setId).push(plan);
  }

  const retained = [];
  for (const plans of grouped.values()) {
    plans.sort((a, b) => b.score - a.score);
    const picks = [
      plans[0],
      plans.find((plan) => plan.targetCount === 2),
      plans.find((plan) => plan.targetCount === 3),
      [...plans].sort((a, b) => b.targetCount - a.targetCount || b.score - a.score)[0]
    ].filter(Boolean);
    for (const plan of picks) {
      if (!retained.some((entry) => planKey(entry) === planKey(plan))) retained.push(plan);
    }
  }

  retained.sort((a, b) => b.score - a.score || b.targetCount - a.targetCount);
  const planLimit = Math.max(1, Number(maxPlans || profile.search.architectureMaxPlans));
  const architectureLimit = Math.max(1, Number(maxArchitectures || profile.search.architectureMaxCount));
  const plans = retained.slice(0, planLimit);
  const architectures = buildArchitectures(plans, eligible, slotRules, architectureLimit, profile);

  return {
    profile: candidatePolicy.targetElement ? `mono-${candidatePolicy.targetElement}` : 'multi',
    targetElement: candidatePolicy.targetElement,
    plans,
    architectures
  };
}
