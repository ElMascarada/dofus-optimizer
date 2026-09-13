import { ELEMENT_SOFT_CAPS } from './config.js';
import { evaluateSyntheticOffense } from './synthetic-offense.js';
import { stat } from './stats.js';
import {
  characteristicInvestmentCost,
  optimizeSyntheticCharacteristics as optimizeSyntheticCharacteristicsLegacy
} from './synthetic-characteristics.js';

const ELEMENTS = Object.freeze(['earth', 'fire', 'water', 'air']);
const EPS = 1e-9;

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

function scoreTableForElement({ stats, availableAp, element, profiles, critMode, minQ, maxQ }) {
  const table = [];
  for (let q = minQ; q <= maxQ; q++) {
    const candidateStats = { ...stats, [element]: stat(stats, element) + q };
    const offense = evaluateSyntheticOffense({
      stats: candidateStats,
      availableAp,
      elements: [element],
      profiles,
      critMode
    });
    table[q] = {
      minimum: offense.minimumScore,
      sum: offense.requestedProbes.reduce((total, probe) => total + probe.totalApBudgetScore, 0)
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

function candidateIsBetter(left, right) {
  if (!right) return true;
  if (left.contribution > right.contribution + EPS) return true;
  if (left.contribution + EPS < right.contribution) return false;
  return String(left.key || '').localeCompare(String(right.key || '')) < 0;
}

function bestSecondQByBudget({ element, minimumQ, maxQ, maximumBudget, softCaps, table }) {
  const best = new Int32Array(maximumBudget + 1);
  best.fill(-1);
  let q = minimumQ;
  let bestQ = -1;
  for (let budget = 0; budget <= maximumBudget; budget++) {
    while (q <= maxQ && characteristicInvestmentCost(q, softCaps) <= budget) {
      if (bestQ < 0
        || Number(table[q]?.sum || 0) > Number(table[bestQ]?.sum || 0) + EPS
        || (Math.abs(Number(table[q]?.sum || 0) - Number(table[bestQ]?.sum || 0)) <= EPS && q < bestQ)) {
        bestQ = q;
      }
      q++;
    }
    best[budget] = bestQ;
  }
  return best;
}

export function optimizeSyntheticCharacteristicsTwoElementFast(options = {}) {
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
  if (requestProbe.elements.length !== 2 || requestProbe.elements.includes('multi')) {
    return optimizeSyntheticCharacteristicsLegacy(options);
  }

  const requested = [...requestProbe.elements];
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
    tables[element] = scoreTableForElement({
      stats: baseWithScroll,
      availableAp,
      element,
      profiles: requestProbe.profiles,
      critMode: requestProbe.critMode,
      minQ: minimums[element],
      maxQ
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

  const [first, second] = requested;
  const fixedElements = ELEMENTS.filter((element) => !requested.includes(element));
  const fixedCost = fixedElements.reduce(
    (sum, element) => sum + characteristicInvestmentCost(scoreMinimums[element], softCaps),
    0
  );
  const maximumSecondBudget = Math.max(0, elementBudget - fixedCost);
  const secondByBudget = bestSecondQByBudget({
    element: second,
    minimumQ: scoreMinimums[second],
    maxQ,
    maximumBudget: maximumSecondBudget,
    softCaps,
    table: tables[second]
  });

  let best = null;
  for (let firstQ = scoreMinimums[first]; firstQ <= maxQ; firstQ++) {
    const firstCost = characteristicInvestmentCost(firstQ, softCaps);
    const remaining = elementBudget - fixedCost - firstCost;
    if (remaining < 0) break;
    const secondQ = secondByBudget[Math.min(remaining, maximumSecondBudget)];
    if (secondQ < scoreMinimums[second]) continue;

    const elemental = { ...scoreMinimums, [first]: firstQ, [second]: secondQ };
    const elementalCost = ELEMENTS.reduce(
      (sum, element) => sum + characteristicInvestmentCost(elemental[element], softCaps),
      0
    );
    if (elementalCost > elementBudget) continue;
    const allocation = { ...elemental, vit: Math.max(0, pointBudget - elementalCost) };
    const candidate = {
      allocation,
      contribution: Number(tables[first][firstQ]?.sum || 0) + Number(tables[second][secondQ]?.sum || 0),
      key: allocationKey(allocation),
      stats: statsWithInvestment(baseStats, scrolled, allocation)
    };
    if (candidateIsBetter(candidate, best)) best = candidate;
  }

  if (!best) return { feasible: false, reason: 'constraint' };
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
    fastPath: 'two-element-no-initiative'
  };
}
