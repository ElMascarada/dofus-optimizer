import { SLOT_RULES } from './config.js';
import { createCandidatePolicy } from '../optimizer/candidate-policy.js';
import { getSearchProfile } from '../optimizer/search-profiles.js';
import { rankSetCoresForPolicy } from '../optimizer/set-core-catalog.js';

const MAX_ARCHITECTURE_CORES_PER_SET_TIER = 2;

function planKey(plan) {
  return String(plan.coreId || `${plan.setId}:${plan.targetCount}:${(plan.memberIds || []).join('+')}`);
}

function structureBonus(plan, profile) {
  const count = Number(plan.targetCount || 0);
  if (count >= 4) return profile.setPlanning.largeSetBonus + count * profile.setPlanning.pieceCountWeight;
  if (count === 3) return profile.setPlanning.activationWeight + count * profile.setPlanning.pieceCountWeight;
  if (count === 2) return profile.setPlanning.activationWeight;
  return 0;
}

function buildArchitectures(plans, maxArchitectures, profile) {
  return (plans || [])
    .map((plan) => ({
      key: planKey(plan),
      plans: [plan],
      score: Number(plan.score || 0) + structureBonus(plan, profile),
      pieceCount: Number(plan.targetCount || 0),
      whySelected: [...new Set(plan.whySelected || [])]
    }))
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

  const requestedPlanLimit = Math.max(1, Number(maxPlans || profile.search.architectureMaxPlans));
  const policyPlanLimit = Math.max(1, Number(profile.candidate.maxSetCorePlans || requestedPlanLimit));
  const planLimit = Math.min(requestedPlanLimit, policyPlanLimit);
  const architectureLimit = Math.max(1, Number(maxArchitectures || profile.search.architectureMaxCount));
  const ranking = rankSetCoresForPolicy(candidatePolicy.setCoreCatalog, candidatePolicy, { limit: Infinity });
  const selectedCores = selectArchitectureCores(ranking.selected, planLimit);
  const plans = selectedCores.map((core) => planFromCore(core, candidatePolicy));
  const architectures = buildArchitectures(plans, architectureLimit, profile);

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
      architectureCandidates: architectures.length,
      combinedCoreArchitectures: false,
      compatibilityAvailable: true
    }
  };
}
