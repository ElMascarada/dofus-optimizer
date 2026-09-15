import { ELEMENT_SOFT_CAPS } from './config.js';
import { stat } from './stats.js';
import { evaluateSyntheticOffense } from './synthetic-offense.js';
import {
  characteristicInvestmentCost,
  optimizeSyntheticCharacteristics as optimizeSyntheticCharacteristicsLegacy
} from './synthetic-characteristics.js';

const ELEMENTS = Object.freeze(['earth', 'fire', 'water', 'air']);
const EPS = 1e-9;
const SLOPE_EPS = 1e-7;

function maxInvestmentForBudget(budget, softCaps) {
  const limit = Math.max(0, Math.floor(Number(budget || 0)));
  let value = 0;
  while (characteristicInvestmentCost(value + 1, softCaps) <= limit) value++;
  return value;
}

function allocationKey(allocation = {}) {
  return [...ELEMENTS, 'vit']
    .map((key) => String(Math.max(0, Math.floor(Number(allocation[key] || 0)))).padStart(5, '0'))
    .join('|');
}

function statsWithInvestment(baseStats, scrolled, allocation) {
  const stats = { ...(baseStats || {}) };
  for (const element of ELEMENTS) {
    stats[element] = stat(stats, element) + Number(scrolled?.[element] || 0) + Number(allocation?.[element] || 0);
  }
  stats.vit = stat(stats, 'vit') + Number(allocation?.vit || 0);
  return stats;
}

function hardElementLowerBounds(baseWithScroll, constraints, minimumStats) {
  const lower = {};
  for (const element of ELEMENTS) {
    const target = Math.max(Number(constraints?.[element] || 0), Number(minimumStats?.[element] || 0), 0);
    lower[element] = Math.max(0, Math.ceil(target - stat(baseWithScroll, element)));
  }
  return lower;
}

function probeScores(offense, element, multi) {
  if (multi) {
    return offense.requestedProbes.flatMap((probe) => probe.lines
      .filter((line) => line.element === element)
      .map((line) => line.expectedValue * probe.equivalentProbeCount));
  }
  return offense.requestedProbes.map((probe) => probe.totalApBudgetScore);
}

function linearScoreTableForElement({ stats, availableAp, element, profiles, critMode, minQ, maxQ, multi }) {
  const requestedElements = multi ? ['multi'] : [element];
  const atZero = evaluateSyntheticOffense({
    stats,
    availableAp,
    elements: requestedElements,
    profiles,
    critMode
  });
  const atOne = evaluateSyntheticOffense({
    stats: { ...stats, [element]: stat(stats, element) + 1 },
    availableAp,
    elements: requestedElements,
    profiles,
    critMode
  });
  const zeroScores = probeScores(atZero, element, multi);
  const oneScores = probeScores(atOne, element, multi);
  const lines = zeroScores.map((intercept, index) => ({
    intercept: Number(intercept || 0),
    slope: Number(oneScores[index] || 0) - Number(intercept || 0)
  }));

  const table = [];
  for (let q = minQ; q <= maxQ; q++) {
    const scores = lines.map((line) => line.intercept + line.slope * q);
    table[q] = {
      minimum: scores.length ? Math.min(...scores) : 0,
      sum: scores.reduce((total, score) => total + score, 0)
    };
  }
  return table;
}

function firstQMeeting(table, minimumQ, maximumQ, target) {
  let low = minimumQ;
  let high = maximumQ;
  let answer = null;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (Number(table[mid]?.minimum) + EPS >= target) {
      answer = mid;
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }
  return answer;
}

function marginalCost(investment, softCaps) {
  return characteristicInvestmentCost(investment + 1, softCaps)
    - characteristicInvestmentCost(investment, softCaps);
}

function minimumCostByTotal(elements, minimums, maxQ, softCaps) {
  if (!elements.length) return { minTotal: 0, maxTotal: 0, costs: [0] };
  const current = Object.fromEntries(elements.map((element) => [element, Number(minimums[element] || 0)]));
  const minTotal = elements.reduce((sum, element) => sum + current[element], 0);
  const maxTotal = elements.length * maxQ;
  const costs = Array(maxTotal + 1).fill(Infinity);
  let total = minTotal;
  let cost = elements.reduce((sum, element) => sum + characteristicInvestmentCost(current[element], softCaps), 0);
  costs[total] = cost;

  while (total < maxTotal) {
    let chosen = null;
    let chosenCost = Infinity;
    for (const element of elements) {
      if (current[element] >= maxQ) continue;
      const nextCost = marginalCost(current[element], softCaps);
      if (nextCost < chosenCost) {
        chosen = element;
        chosenCost = nextCost;
      }
    }
    if (!chosen || !Number.isFinite(chosenCost)) break;
    current[chosen]++;
    total++;
    cost += chosenCost;
    costs[total] = cost;
  }
  return { minTotal, maxTotal, costs };
}

function tableSlope(table, minQ, maxQ) {
  if (maxQ <= minQ) return 0;
  const first = Number(table[minQ + 1]?.sum || 0) - Number(table[minQ]?.sum || 0);
  const last = Number(table[maxQ]?.sum || 0) - Number(table[maxQ - 1]?.sum || 0);
  if (Math.abs(first - last) > SLOPE_EPS * Math.max(1, Math.abs(first), Math.abs(last))) return null;
  return first;
}

function equalRequestedSlopes(elements, tables, minimums, maxQ) {
  const slopes = elements.map((element) => tableSlope(tables[element], minimums[element], maxQ));
  if (slopes.some((slope) => slope == null)) return null;
  const reference = slopes[0] ?? 0;
  if (slopes.some((slope) => Math.abs(slope - reference) > SLOPE_EPS * Math.max(1, Math.abs(reference), Math.abs(slope)))) {
    return null;
  }
  return reference;
}

function optimizeEqualSlopeSecondary({ minimums, elementBudget, maxQ, softCaps, tables, requested, baseStats, scrolled, points }) {
  const slope = equalRequestedSlopes(requested, tables, minimums, maxQ);
  if (slope == null) return null;

  const allocation = { ...minimums };
  if (slope > EPS) {
    const requestedSet = new Set(requested);
    const fixedCost = ELEMENTS
      .filter((element) => !requestedSet.has(element))
      .reduce((sum, element) => sum + characteristicInvestmentCost(allocation[element], softCaps), 0);
    const suffixCosts = requested.map((_, index) => minimumCostByTotal(
      requested.slice(index),
      minimums,
      maxQ,
      softCaps
    ));
    suffixCosts.push({ minTotal: 0, maxTotal: 0, costs: [0] });

    const full = suffixCosts[0];
    let targetTotal = full.minTotal;
    for (let total = full.minTotal; total <= full.maxTotal; total++) {
      if (fixedCost + Number(full.costs[total]) <= elementBudget) targetTotal = total;
      else break;
    }

    let prefixCost = fixedCost;
    let remainingTotal = targetTotal;
    for (let index = 0; index < requested.length; index++) {
      const element = requested[index];
      const suffix = suffixCosts[index + 1];
      let chosen = null;
      for (let q = Number(minimums[element] || 0); q <= maxQ; q++) {
        const suffixTotal = remainingTotal - q;
        if (suffixTotal < suffix.minTotal || suffixTotal > suffix.maxTotal) continue;
        const suffixCost = Number(suffix.costs[suffixTotal]);
        if (!Number.isFinite(suffixCost)) continue;
        const totalCost = prefixCost + characteristicInvestmentCost(q, softCaps) + suffixCost;
        if (totalCost <= elementBudget) {
          chosen = q;
          break;
        }
      }
      if (chosen == null) return null;
      allocation[element] = chosen;
      prefixCost += characteristicInvestmentCost(chosen, softCaps);
      remainingTotal -= chosen;
    }
  }

  const elementalCost = ELEMENTS.reduce(
    (sum, element) => sum + characteristicInvestmentCost(allocation[element], softCaps),
    0
  );
  if (elementalCost > elementBudget) return null;
  allocation.vit = Math.max(0, points - elementalCost);
  return {
    allocation,
    key: allocationKey(allocation),
    stats: statsWithInvestment(baseStats, scrolled, allocation)
  };
}

export function optimizeSyntheticCharacteristicsTriMultiLinear(options = {}) {
  const {
    baseStats = {},
    points = 995,
    scrolled = {},
    constraints = {},
    minimumStats = {},
    availableAp,
    elements,
    profiles,
    critMode = 'auto',
    softCaps = ELEMENT_SOFT_CAPS
  } = options;

  if (Number(constraints?.initiative || 0) > 0) {
    return optimizeSyntheticCharacteristicsLegacy(options);
  }

  const pointBudget = Math.max(0, Math.floor(Number(points || 0)));
  const baseWithScroll = statsWithInvestment(baseStats, scrolled, {});
  const requestProbe = evaluateSyntheticOffense({ stats: baseWithScroll, availableAp, elements, profiles, critMode });
  const isMulti = requestProbe.elements.length === 1 && requestProbe.elements[0] === 'multi';
  const requested = isMulti ? [...ELEMENTS] : requestProbe.elements.filter((element) => ELEMENTS.includes(element));
  if (!isMulti && requested.length !== 3) return optimizeSyntheticCharacteristicsLegacy(options);

  const minimums = hardElementLowerBounds(baseWithScroll, constraints, minimumStats);
  const minimumVitality = Math.max(0, Math.ceil(Number(constraints?.vit || 0) - stat(baseWithScroll, 'vit')));
  const elementBudget = pointBudget - minimumVitality;
  if (elementBudget < 0) return { feasible: false, reason: 'constraint' };

  const lowerCost = ELEMENTS.reduce(
    (sum, element) => sum + characteristicInvestmentCost(minimums[element], softCaps),
    0
  );
  if (!Number.isFinite(lowerCost) || lowerCost > elementBudget) {
    return { feasible: false, reason: 'constraint' };
  }

  const maxQ = maxInvestmentForBudget(elementBudget, softCaps);
  const tables = {};
  for (const element of requested) {
    tables[element] = linearScoreTableForElement({
      stats: baseWithScroll,
      availableAp,
      element,
      profiles: requestProbe.profiles,
      critMode: requestProbe.critMode,
      minQ: minimums[element],
      maxQ,
      multi: isMulti
    });
  }

  const thresholds = [];
  for (const element of requested) {
    for (let q = minimums[element]; q <= maxQ; q++) thresholds.push(tables[element][q].minimum);
  }
  thresholds.sort((a, b) => a - b);
  const uniqueThresholds = thresholds.filter(
    (value, index) => index === 0 || Math.abs(value - thresholds[index - 1]) > EPS
  );

  const minimumsForThreshold = (target) => {
    const resolved = { ...minimums };
    for (const element of requested) {
      const q = firstQMeeting(tables[element], minimums[element], maxQ, target);
      if (q == null) return null;
      resolved[element] = Math.max(resolved[element], q);
    }
    return resolved;
  };
  const thresholdFeasible = (target) => {
    const resolved = minimumsForThreshold(target);
    if (!resolved) return false;
    const cost = ELEMENTS.reduce(
      (sum, element) => sum + characteristicInvestmentCost(resolved[element], softCaps),
      0
    );
    return cost <= elementBudget;
  };

  let low = 0;
  let high = uniqueThresholds.length - 1;
  let bestThreshold = uniqueThresholds[0] ?? requestProbe.minimumScore;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (thresholdFeasible(uniqueThresholds[mid])) {
      bestThreshold = uniqueThresholds[mid];
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  const scoreMinimums = minimumsForThreshold(bestThreshold);
  if (!scoreMinimums) return { feasible: false, reason: 'evaluation-failed' };
  const best = optimizeEqualSlopeSecondary({
    minimums: scoreMinimums,
    elementBudget,
    maxQ,
    softCaps,
    tables,
    requested,
    baseStats,
    scrolled,
    points: pointBudget
  });
  if (!best) return optimizeSyntheticCharacteristicsLegacy(options);

  const offense = evaluateSyntheticOffense({
    stats: best.stats,
    availableAp,
    elements: requestProbe.elements,
    profiles: requestProbe.profiles,
    critMode: requestProbe.critMode
  });
  return {
    feasible: true,
    stats: best.stats,
    allocation: best.allocation,
    minimumStats: { ...minimumStats },
    offense,
    deterministicAllocationKey: best.key,
    requiredTotalElementInvestmentForInitiative: 0,
    fastPath: 'tri-multi-linear'
  };
}
