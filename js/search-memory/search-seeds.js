import { SLOT_RULES } from '../config.js';
import { specialSlotRulesAreValid } from '../build-legality.js';
import { evaluateCompleteBuild } from '../complete-build-evaluator.js';

function buildKey(itemIds = []) {
  return [...itemIds].map(String).sort().join('|');
}

export function seedDescriptorsFromNearby(nearby = [], { maxBuilds = 8 } = {}) {
  const candidates = [];
  for (const entry of nearby || []) {
    const record = entry?.record || entry;
    const distance = Number(entry?.distance || 0);
    for (const result of record?.output?.results || []) {
      const itemIds = [...new Set((result?.itemIds || []).map(String).filter(Boolean))];
      if (!itemIds.length) continue;
      candidates.push({
        itemIds,
        sourceFingerprint: String(record.fingerprint || ''),
        sourceDistance: distance,
        sourceScore: Number(result?.score || 0)
      });
    }
  }
  candidates.sort((a, b) => a.sourceDistance - b.sourceDistance || b.sourceScore - a.sourceScore);
  const seen = new Set();
  const output = [];
  for (const candidate of candidates) {
    const key = buildKey(candidate.itemIds);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(candidate);
    if (output.length >= Math.max(0, Number(maxBuilds || 0))) break;
  }
  return output;
}

export function mergeSeedDescriptors(groups = [], { maxBuilds = 8 } = {}) {
  const seen = new Set();
  const output = [];
  for (const group of groups || []) {
    for (const seed of group || []) {
      const itemIds = [...new Set((seed?.itemIds || []).map(String).filter(Boolean))];
      const key = buildKey(itemIds);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      output.push({ ...seed, itemIds });
      if (output.length >= Math.max(0, Number(maxBuilds || 0))) return output;
    }
  }
  return output;
}

function fullBuildShape(items = []) {
  const counts = new Map();
  for (const item of items || []) counts.set(item?.slot, (counts.get(item?.slot) || 0) + 1);
  return SLOT_RULES.every((rule) => (counts.get(rule.id) || 0) === Number(rule.count || 0))
    && specialSlotRulesAreValid(items);
}

function addReason(target, reason) {
  target[reason] = (target[reason] || 0) + 1;
}

export function evaluateSearchSeedBuilds({
  seedBuilds = [],
  items = [],
  sets = [],
  selections = [],
  constraints = {},
  fmPolicy = {},
  turnMode = 'sum',
  scenario = {},
  requiredItemIds = [],
  rejectedItemIds = [],
  evaluate = evaluateCompleteBuild
} = {}) {
  const itemById = new Map((items || []).map((item) => [String(item.id), item]));
  const required = new Set((requiredItemIds || []).map(String).filter(Boolean));
  const rejectedIds = new Set((rejectedItemIds || []).map(String).filter(Boolean));
  const results = [];
  const rejected = {};
  let rehydrated = 0;

  for (const seed of seedBuilds || []) {
    const ids = [...new Set((seed?.itemIds || []).map(String).filter(Boolean))];
    const idSet = new Set(ids);
    if ([...required].some((id) => !idSet.has(id))) {
      addReason(rejected, 'missing-required-item');
      continue;
    }
    if (ids.some((id) => rejectedIds.has(id))) {
      addReason(rejected, 'rejected-item');
      continue;
    }
    const resolved = ids.map((id) => itemById.get(id));
    if (!ids.length || resolved.some((item) => !item)) {
      addReason(rejected, 'missing-item');
      continue;
    }
    if (!fullBuildShape(resolved)) {
      addReason(rejected, 'shape');
      continue;
    }
    rehydrated++;
    const evaluation = evaluate({
      items: resolved,
      sets,
      selections,
      constraints,
      fmPolicy: { ...fmPolicy, structuralExos: false },
      turnMode,
      scenario
    });
    if (!evaluation?.result) {
      addReason(rejected, evaluation?.reason || 'evaluation-failed');
      continue;
    }
    results.push({
      ...evaluation.result,
      searchOrigin: 'seed',
      seedSourceFingerprint: String(seed?.sourceFingerprint || ''),
      seedSourceDistance: Number(seed?.sourceDistance || 0)
    });
  }

  results.sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
  return {
    results,
    diagnostics: {
      attempted: (seedBuilds || []).length,
      rehydrated,
      valid: results.length,
      rejected
    }
  };
}
