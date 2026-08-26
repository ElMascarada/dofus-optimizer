import { SLOT_RULES } from './config.js';
import { specialSlotRulesAreValid } from './build-legality.js';
import { createCandidatePolicy } from '../optimizer/candidate-policy.js';
import { getSearchProfile } from '../optimizer/search-profiles.js';
import { areSetCoresCompatible, rankSetCoresForPolicy } from '../optimizer/set-core-catalog.js';

const MAX_ARCHITECTURE_CORES_PER_SET_TIER = 2;

function slotCapacities(slotRules = SLOT_RULES) {
  return new Map((slotRules || SLOT_RULES).map((rule) => [rule.id, Number(rule.count || 0)]));
}

function planKey(plan) {
  return String(plan.coreId || `${plan.setId}:${plan.targetCount}:${(plan.memberIds || []).join('+')}`);
}

function architectureKey(plans) {
  return plans.map(planKey).sort().join('|');
}

function plansCompatible(plans, slotRules) {
  const setIds = new Set();
  const itemIds = new Set();
  const capacities = slotCapacities(slotRules);
  const usedSlots = new Map();
  const allItems = [];

  for (let index = 0; index < plans.length; index++) {
    const plan = plans[index];
    if (setIds.has(plan.setId)) return false;
    setIds.add(plan.setId);
    for (let previous = 0; previous < index; previous++) {
      if (!areSetCoresCompatible(plans[previous].core, plan.core, slotRules).compatible) return false;
    }
    for (const item of plan.items || []) {
      const id = String(item.id);
      if (itemIds.has(id)) return false;
      itemIds.add(id);
      allItems.push(item);
      const used = (usedSlots.get(item.slot) || 0) + 1;
      if (used > (capacities.get(item.slot) || 0)) return false;
      usedSlots.set(item.slot, used);
    }
  }

  return specialSlotRulesAreValid(allItems);
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

function buildArchitectures(plans, slotRules, maxArchitectures, profile) {
  const architectures = new Map();

  function add(combo) {
    if (!combo.length || !plansCompatible(combo, slotRules)) return;
    const key = architectureKey(combo);
    if (architectures.has(key)) return;
    architectures.set(key, {
      key,
      plans: [...combo],
      score: combo.reduce((sum, plan) => sum + Number(plan.score || 0), 0) + structureBonus(combo, profile),
      pieceCount: new Set(combo.flatMap((plan) => plan.memberIds || []).map(String)).size,
      whySelected: [...new Set(combo.flatMap((plan) => plan.whySelected || []))]
    });
  }

  function visit(start, size, combo) {
    if (combo.length === size) {
      add(combo);
      return;
    }
    for (let index = start; index < plans.length; index++) {
      combo.push(plans[index]);
      if (plansCompatible(combo, slotRules)) visit(index + 1, size, combo);
      combo.pop();
    }
  }

  for (const plan of plans) add([plan]);
  const maxCombo = Math.min(4, plans.length);
  for (let size = 2; size <= maxCombo; size++) visit(0, size, []);

  return [...architectures.values()]
    .sort((a, b) => b.score - a.score || b.pieceCount - a.pieceCount || a.key.localeCompare(b.key))
    .slice(0, Math.max(1, Number(maxArchitectures || 1)));
}

function selectArchitectureCores(rankedCores, limit) {
  const selected = [];
  const perSetTier = new Map();
  for (const core of rankedCores || []) {
    const key = `${core.setId}:${core.pieceCount}`;
    const used = perSetTier.get(key) || 0;
    if (used >= MAX_ARCHITECTURE_CORES_PER_SET_TIER) continue;
    selected.push(core);
    perSetTier.set(key, used + 1);
    if (selected.length >= limit) break;
  }
  return selected;
}

function planFromCore(core, candidatePolicy) {
  return {
    coreId: core.id,
    core,
    setId: core.setId,
    name: core.setName,
    targetCount: core.pieceCount,
    memberIds: [...core.itemIds],
    memberScores: core.items.map((item) => Number(candidatePolicy.profileItem(item).rankScore || 0)),
    items: [...core.items],
    occupiedSlots: { ...core.occupiedSlots },
    bonus: { ...core.setBonuses },
    aggregateStats: { ...core.aggregateStats },
    tags: [...core.tags],
    profile: core.profile,
    whySelected: [...(core.whySelected || [])],
    score: Number(core.searchScore || 0)
  };
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

  const planLimit = Math.max(1, Number(maxPlans || profile.search.architectureMaxPlans));
  const architectureLimit = Math.max(1, Number(maxArchitectures || profile.search.architectureMaxCount));
  const ranking = rankSetCoresForPolicy(candidatePolicy.setCoreCatalog, candidatePolicy, { limit: Infinity });
  const selectedCores = selectArchitectureCores(ranking.selected, planLimit);
  const plans = selectedCores.map((core) => planFromCore(core, candidatePolicy));
  const architectures = buildArchitectures(plans, slotRules, architectureLimit, profile);

  return {
    profile: candidatePolicy.targetElement ? `mono-${candidatePolicy.targetElement}` : 'multi',
    targetElement: candidatePolicy.targetElement,
    plans,
    architectures,
    diagnostics: {
      ...ranking.diagnostics,
      injected: plans.length,
      architecturePlanLimit: planLimit,
      architecturePlans: plans.length,
      architecturePlanVariantsSkipped: Math.max(0, ranking.selected.length - plans.length),
      architecturePerSetTierLimit: MAX_ARCHITECTURE_CORES_PER_SET_TIER,
      architectureCandidates: architectures.length
    }
  };
}
