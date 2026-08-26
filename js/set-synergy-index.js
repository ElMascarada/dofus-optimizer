import { SLOT_RULES } from './config.js';
import { createSetCoreAwareCandidatePolicy } from '../optimizer/set-core-candidate-policy.js';
import { getSearchProfile } from '../optimizer/search-profiles.js';

function slotCapacities(slotRules = SLOT_RULES) {
  return new Map((slotRules || SLOT_RULES).map((rule) => [rule.id, Number(rule.count || 0)]));
}

function architectureCompatible(plans, itemById, capacities) {
  const setIds = new Set();
  const itemIds = new Set();
  const slots = new Map();
  for (const plan of plans) {
    // Combining two alternative cores from the same set is redundant: a larger
    // canonical core already represents that activation level.
    if (setIds.has(plan.setId)) return false;
    setIds.add(plan.setId);
    for (const rawId of plan.memberIds || []) {
      const id = String(rawId);
      if (itemIds.has(id)) return false;
      const item = itemById.get(id);
      if (!item) return false;
      itemIds.add(id);
      const next = (slots.get(item.slot) || 0) + 1;
      if (next > Number(capacities.get(item.slot) || 0)) return false;
      slots.set(item.slot, next);
    }
  }
  return true;
}

function architectureKey(plans) {
  return plans.map((plan) => plan.id).sort().join('|');
}

function structureBonus(plans, profile) {
  return plans.reduce((sum, plan) => {
    const count = Number(plan.targetCount || 0);
    const activation = count >= 2 ? profile.setPlanning.activationWeight : 0;
    const large = count >= 4 ? profile.setPlanning.largeSetBonus : 0;
    return sum + activation + large + count * profile.setPlanning.pieceCountWeight;
  }, 0);
}

function buildArchitectures(plans, items, slotRules, maxArchitectures, profile) {
  const itemById = new Map(items.map((item) => [String(item.id), item]));
  const capacities = slotCapacities(slotRules);
  const architectures = [];
  const seen = new Set();

  function add(combo) {
    if (!combo.length || !architectureCompatible(combo, itemById, capacities)) return;
    const key = architectureKey(combo);
    if (seen.has(key)) return;
    seen.add(key);
    architectures.push({
      key,
      plans: [...combo],
      score: combo.reduce((sum, plan) => sum + Number(plan.score || 0), 0) + structureBonus(combo, profile),
      pieceCount: combo.reduce((sum, plan) => sum + Number(plan.targetCount || 0), 0)
    });
  }

  // This PR exposes compatibility but deliberately avoids a massive core-combo
  // search. Singles and compatible pairs are enough to seed the existing solver.
  for (const plan of plans) add([plan]);
  for (let i = 0; i < plans.length; i++) {
    for (let j = i + 1; j < plans.length; j++) add([plans[i], plans[j]]);
  }

  return architectures
    .sort((a, b) => b.score - a.score || b.pieceCount - a.pieceCount || a.key.localeCompare(b.key))
    .slice(0, Math.max(1, Number(maxArchitectures || 1)));
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
  const candidatePolicy = policy || createSetCoreAwareCandidatePolicy({
    items,
    sets,
    selections,
    constraints,
    turnMode,
    scenario,
    slotRules,
    searchProfile: profile
  });
  const itemById = new Map(items.map((item) => [String(item.id), item]));
  const planLimit = Math.max(1, Number(maxPlans || profile.search.architectureMaxPlans));
  const architectureLimit = Math.max(1, Number(maxArchitectures || profile.search.architectureMaxCount));
  const plans = (candidatePolicy.setCoreHints || []).slice(0, planLimit).map((core) => ({
    id: core.id,
    setId: core.setId,
    name: core.setName || core.name || core.setId,
    targetCount: Number(core.pieceCount || core.targetCount || 0),
    memberIds: [...(core.memberIds || core.items || [])].map(String),
    memberScores: [...(core.memberIds || core.items || [])].map((id) => {
      const item = itemById.get(String(id));
      return item ? Number(candidatePolicy.profileItem(item).rankScore || 0) : 0;
    }),
    bonus: { ...(core.setBonuses || core.bonus || {}) },
    tags: [...(core.tags || [])],
    whySelected: [...(core.whySelected || [])],
    score: Number(core.policyScore || core.score || 0)
  }));

  return {
    profile: candidatePolicy.targetElement ? `mono-${candidatePolicy.targetElement}` : 'multi',
    targetElement: candidatePolicy.targetElement,
    plans,
    architectures: buildArchitectures(plans, items, slotRules, architectureLimit, profile),
    diagnostics: { ...(candidatePolicy.setCoreDiagnostics || {}) }
  };
}
