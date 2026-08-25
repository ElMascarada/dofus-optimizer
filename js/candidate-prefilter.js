import { SLOT_RULES } from './config.js';
import {
  activeSpellElements,
  buildCandidatePools
} from '../optimizer/candidate-policy.js';
import { withCandidateOverrides } from '../optimizer/search-profiles.js';

export { activeSpellElements };

function comboApTarget(scenario = {}) {
  const values = Object.values(scenario?.requiredApByTurn || {})
    .map((value) => Number(value || 0))
    .filter(Number.isFinite);
  return values.length ? Math.max(...values) : 0;
}

export function prefilterItems({
  items = [],
  sets = [],
  selections = [],
  constraints = {},
  turnMode = 'sum',
  scenario = {},
  slotRules = SLOT_RULES,
  slotLimits = null,
  maxRelevantSets = null,
  constraintReservePerStat = null,
  requiredItemIds = [],
  searchProfile = 'BALANCED'
} = {}) {
  const candidateOverrides = {};
  if (slotLimits) candidateOverrides.slotPoolTargets = slotLimits;
  if (Number(maxRelevantSets) > 0) candidateOverrides.maxSetCorePlans = Number(maxRelevantSets);
  if (Number(constraintReservePerStat) > 0) candidateOverrides.constraintReservePerStat = Number(constraintReservePerStat);
  const profile = withCandidateOverrides(searchProfile, candidateOverrides);
  const result = buildCandidatePools({
    items,
    sets,
    selections,
    constraints,
    turnMode,
    scenario,
    searchProfile: profile,
    slotRules,
    requiredItemIds
  });
  return {
    items: result.items,
    pools: result.pools,
    policy: result.policy,
    diagnostics: {
      ...result.diagnostics,
      apTarget: Number(constraints?.ap || 0),
      comboApTarget: comboApTarget(scenario)
    }
  };
}
