import { SLOT_RULES } from './config.js';
import { evaluateCompleteBuild } from './complete-build-evaluator.js';
import { specialSlotRulesAreValid } from './build-legality.js';

function slotCounts(items = []) {
  const counts = new Map();
  for (const item of items || []) counts.set(item?.slot, (counts.get(item?.slot) || 0) + 1);
  return counts;
}

function hasCompleteShape(items = []) {
  const counts = slotCounts(items);
  return SLOT_RULES.every((rule) => (counts.get(rule.id) || 0) === Number(rule.count || 0))
    && specialSlotRulesAreValid(items);
}

function requiredItemsPresent(items = [], requiredItemIds = []) {
  if (!(requiredItemIds || []).length) return true;
  const ids = new Set((items || []).map((item) => String(item.id)));
  return requiredItemIds.every((id) => ids.has(String(id)));
}

function addReason(reasons, reason) {
  reasons[reason] = Number(reasons[reason] || 0) + 1;
}

export function evaluateSearchSeeds({
  seedBuilds = [],
  payload = {}
} = {}) {
  const itemById = new Map((payload?.items || []).map((item) => [String(item.id), item]));
  const results = [];
  const rejected = {};
  const seen = new Set();
  let hydrated = 0;
  let evaluated = 0;

  for (const seed of seedBuilds || []) {
    const itemIds = (seed?.itemIds || []).map(String).filter(Boolean);
    const key = [...itemIds].sort().join('|');
    if (!key || seen.has(key)) continue;
    seen.add(key);

    const items = itemIds.map((id) => itemById.get(id));
    if (items.some((item) => !item)) {
      addReason(rejected, 'missing-item');
      continue;
    }
    hydrated++;
    if (!hasCompleteShape(items)) {
      addReason(rejected, 'incomplete-shape');
      continue;
    }
    if (!requiredItemsPresent(items, payload?.requiredItemIds || [])) {
      addReason(rejected, 'required-item');
      continue;
    }

    evaluated++;
    const evaluation = evaluateCompleteBuild({
      items,
      sets: payload?.sets || [],
      selections: payload?.selections || [],
      constraints: payload?.constraints || {},
      fmPolicy: payload?.fmPolicy || {},
      turnMode: payload?.turnMode || 'sum',
      scenario: payload?.scenario || {}
    });
    if (!evaluation.result) {
      addReason(rejected, evaluation.reason || 'evaluation-failed');
      continue;
    }
    results.push({
      ...evaluation.result,
      searchOrigin: 'seed',
      seedSourceFingerprint: String(seed?.sourceFingerprint || ''),
      seedSourceScore: Number(seed?.sourceScore || 0),
      seedSimilarity: Number(seed?.similarity || 0)
    });
  }

  results.sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
  return {
    results,
    diagnostics: {
      requested: (seedBuilds || []).length,
      unique: seen.size,
      hydrated,
      evaluated,
      valid: results.length,
      rejected
    }
  };
}
