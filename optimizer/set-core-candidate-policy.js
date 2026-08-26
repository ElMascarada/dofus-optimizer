import { SLOT_RULES } from '../js/config.js';
import {
  createCandidatePolicy,
  positiveConstraintKeys,
  selectCandidatePoolForSlot
} from './candidate-policy.js';
import { buildSetCoreCatalog, selectRelevantSetCores } from './set-core-catalog.js';

function toCandidateHint(core) {
  return {
    ...core,
    targetCount: core.pieceCount,
    memberIds: [...core.items],
    score: Number(core.policyScore || 0)
  };
}

export function createSetCoreAwareCandidatePolicy({
  items = [],
  sets = [],
  selections = [],
  constraints = {},
  turnMode = 'sum',
  scenario = {},
  searchProfile = 'BALANCED',
  slotRules = SLOT_RULES,
  enableSetCores = true
} = {}) {
  const policy = createCandidatePolicy({
    items,
    sets,
    selections,
    constraints,
    turnMode,
    scenario,
    searchProfile,
    slotRules
  });

  if (!enableSetCores) {
    policy.setCoreCatalog = { cores: [], diagnostics: { setsTotal: sets.length, setsWithCores: 0, generated: 0, illegalRemoved: 0, dominatedRemoved: 0, retained: 0 } };
    policy.setCoreHints = [];
    policy.setCoreDiagnostics = { ...policy.setCoreCatalog.diagnostics, relevant: 0, injected: 0 };
    return policy;
  }

  const catalog = buildSetCoreCatalog({ items, sets, slotRules });
  const relevant = selectRelevantSetCores(catalog, policy, policy.profile.candidate.maxSetCorePlans);
  policy.setCoreCatalog = catalog;
  policy.setCoreHints = relevant.map(toCandidateHint);
  policy.setCoreDiagnostics = {
    ...catalog.diagnostics,
    relevant: relevant.length,
    injected: relevant.length
  };
  return policy;
}

export function buildSetCoreAwareCandidatePools({
  items = [],
  sets = [],
  selections = [],
  constraints = {},
  turnMode = 'sum',
  scenario = {},
  searchProfile = 'BALANCED',
  slotRules = SLOT_RULES,
  requiredItemIds = [],
  enableSetCores = true
} = {}) {
  const policy = createSetCoreAwareCandidatePolicy({
    items,
    sets,
    selections,
    constraints,
    turnMode,
    scenario,
    searchProfile,
    slotRules,
    enableSetCores
  });
  const pools = {};
  const output = [];
  const slots = [];
  const injectedCoreIds = new Set();

  for (const rule of slotRules || SLOT_RULES) {
    const selected = selectCandidatePoolForSlot({ items, rule, policy, requiredItemIds });
    pools[rule.id] = selected.items;
    output.push(...selected.items);
    slots.push(selected.diagnostics);
    for (const [id, reasons] of Object.entries(selected.diagnostics.reasons || {})) {
      if (!(reasons || []).includes('set-core')) continue;
      for (const core of policy.setCoreHints) {
        if (core.memberIds.includes(String(id))) injectedCoreIds.add(core.id);
      }
    }
  }

  policy.setCoreDiagnostics.injected = injectedCoreIds.size;
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
      relevantSets: new Set(policy.setCoreHints.map((core) => core.setId)).size,
      setCores: { ...policy.setCoreDiagnostics },
      topSetPlans: policy.setCoreHints.map((core) => ({
        id: core.id,
        setId: core.setId,
        name: core.setName,
        targetCount: core.pieceCount,
        memberIds: [...core.memberIds],
        score: core.score,
        tags: [...core.tags],
        whySelected: [...core.whySelected]
      })),
      slots
    }
  };
}
