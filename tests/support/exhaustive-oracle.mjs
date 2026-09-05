import { performance } from 'node:perf_hooks';
import { SLOT_RULES } from '../../js/config.js';
import { specialSlotRulesAreValid } from '../../js/build-legality.js';
import { evaluateCompleteBuild } from '../../js/complete-build-evaluator.js';

export const DEFAULT_ORACLE_MAX_COMBINATIONS = 100000;

function normalizeSlots(slots = SLOT_RULES) {
  return (slots || []).map((slot) => {
    const id = String(slot?.id || '');
    const count = Number(slot?.count || 0);
    if (!id || !Number.isInteger(count) || count <= 0) {
      throw new TypeError(`Invalid oracle slot rule: ${JSON.stringify(slot)}`);
    }
    return { id, count };
  });
}

function itemId(item) {
  return String(item?.id ?? '');
}

function uniqueItemsForSlot(items, slotId) {
  const seen = new Set();
  const output = [];
  for (const item of items || []) {
    if (item?.slot !== slotId) continue;
    const id = itemId(item);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    output.push(item);
  }
  output.sort((a, b) => itemId(a).localeCompare(itemId(b)));
  return output;
}

function chooseCount(n, k) {
  if (k < 0 || n < k) return 0n;
  const reduced = Math.min(k, n - k);
  let value = 1n;
  for (let index = 1; index <= reduced; index++) {
    value = value * BigInt(n - reduced + index) / BigInt(index);
  }
  return value;
}

function exactEstimate(items, slots) {
  let total = 1n;
  const pools = new Map();
  for (const slot of slots) {
    const pool = uniqueItemsForSlot(items, slot.id);
    pools.set(slot.id, pool);
    total *= chooseCount(pool.length, slot.count);
  }
  return { total, pools };
}

function numericEstimate(total) {
  return total <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(total) : Infinity;
}

export function estimateExhaustiveCombinations({ items = [], slots = SLOT_RULES } = {}) {
  const normalizedSlots = normalizeSlots(slots);
  const { total } = exactEstimate(items, normalizedSlots);
  return {
    estimatedCombinations: numericEstimate(total),
    estimatedCombinationsExact: total.toString()
  };
}

function combinations(items, count) {
  if (count === 0) return [[]];
  if (items.length < count) return [];
  const output = [];
  const prefix = [];

  function visit(start) {
    if (prefix.length === count) {
      output.push([...prefix]);
      return;
    }
    const remaining = count - prefix.length;
    for (let index = start; index <= items.length - remaining; index++) {
      prefix.push(items[index]);
      visit(index + 1);
      prefix.pop();
    }
  }

  visit(0);
  return output;
}

export function canonicalBuildKey(buildOrItems = []) {
  const items = Array.isArray(buildOrItems) ? buildOrItems : buildOrItems?.items || [];
  return items.map(itemId).sort().join('|');
}

function insertExactTop(results, result, topN) {
  const key = canonicalBuildKey(result);
  const existing = results.findIndex((entry) => canonicalBuildKey(entry) === key);
  if (existing >= 0) {
    if (Number(results[existing].score || 0) >= Number(result.score || 0)) return;
    results.splice(existing, 1);
  }
  results.push(result);
  results.sort((a, b) => Number(b.score || 0) - Number(a.score || 0)
    || canonicalBuildKey(a).localeCompare(canonicalBuildKey(b)));
  if (results.length > topN) results.length = topN;
}

function hasActiveConstraints(constraints = {}) {
  return Object.values(constraints || {}).some((value) => Number.isFinite(value) && Number(value) > 0);
}

function spaceLimitError(total, limit) {
  const error = new RangeError(
    `Exhaustive oracle search space ${total.toString()} exceeds maxCombinations=${limit}`
  );
  error.code = 'ORACLE_SPACE_LIMIT_EXCEEDED';
  error.estimatedCombinations = numericEstimate(total);
  error.estimatedCombinationsExact = total.toString();
  error.maxCombinations = limit;
  return error;
}

export function runExhaustiveOracle({
  items = [],
  sets = [],
  slots = SLOT_RULES,
  constraints = {},
  selections = [],
  fmPolicy = {},
  turnMode = 'sum',
  scenario = {},
  topN = 10,
  maxCombinations = DEFAULT_ORACLE_MAX_COMBINATIONS
} = {}) {
  const startedAt = performance.now();
  const normalizedSlots = normalizeSlots(slots);
  const limit = Number(maxCombinations);
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new TypeError(`Invalid maxCombinations: ${maxCombinations}`);
  }

  const { total: estimatedTotal, pools } = exactEstimate(items, normalizedSlots);
  if (estimatedTotal > BigInt(limit)) throw spaceLimitError(estimatedTotal, limit);

  const choicesBySlot = normalizedSlots.map((slot) => ({
    ...slot,
    choices: combinations(pools.get(slot.id) || [], slot.count)
  }));
  const resultLimit = Math.max(1, Number.isFinite(Number(topN)) ? Math.floor(Number(topN)) : 10);
  const topResults = [];
  const seenBuilds = new Set();
  let combinationsGenerated = 0;
  let legal = 0;
  let constraintValid = 0;

  function evaluate(itemsForBuild) {
    const key = canonicalBuildKey(itemsForBuild);
    if (seenBuilds.has(key)) return;
    seenBuilds.add(key);
    combinationsGenerated++;

    if (!specialSlotRulesAreValid(itemsForBuild)) return;

    const legalityEvaluation = evaluateCompleteBuild({
      items: itemsForBuild,
      sets,
      selections,
      constraints: {},
      fmPolicy,
      turnMode,
      scenario
    });
    if (!legalityEvaluation.result) return;
    legal++;

    const constrainedEvaluation = hasActiveConstraints(constraints)
      ? evaluateCompleteBuild({
          items: itemsForBuild,
          sets,
          selections,
          constraints,
          fmPolicy,
          turnMode,
          scenario
        })
      : legalityEvaluation;
    if (!constrainedEvaluation.result) return;

    constraintValid++;
    insertExactTop(topResults, constrainedEvaluation.result, resultLimit);
  }

  function enumerate(slotIndex, selected, selectedIds) {
    if (slotIndex >= choicesBySlot.length) {
      evaluate(selected);
      return;
    }

    for (const choice of choicesBySlot[slotIndex].choices) {
      if (choice.some((item) => selectedIds.has(itemId(item)))) continue;
      const nextIds = new Set(selectedIds);
      for (const item of choice) nextIds.add(itemId(item));
      enumerate(slotIndex + 1, [...selected, ...choice], nextIds);
    }
  }

  if (estimatedTotal > 0n) enumerate(0, [], new Set());

  const durationMs = performance.now() - startedAt;
  return {
    bestScore: topResults[0]?.score ?? null,
    bestBuild: topResults[0] ?? null,
    topN: [...topResults],
    estimatedCombinations: numericEstimate(estimatedTotal),
    estimatedCombinationsExact: estimatedTotal.toString(),
    combinations: combinationsGenerated,
    combinationsGenerated,
    legal,
    constraintValid,
    durationMs
  };
}
