import { ELEMENT_SOFT_CAPS } from './config.js';
import { initiativeContribution, stat } from './stats.js';
import { evaluateSyntheticOffense } from './synthetic-offense.js';

const ELEMENTS = Object.freeze(['earth', 'fire', 'water', 'air']);
const EPS = 1e-9;

export function characteristicInvestmentCost(amount = 0, softCaps = ELEMENT_SOFT_CAPS) {
  let remaining = Math.max(0, Math.floor(Number(amount || 0)));
  let cost = 0;
  for (const cap of softCaps || []) {
    if (remaining <= 0) break;
    const capacity = Number.isFinite(cap.amount) ? Math.max(0, Math.floor(cap.amount)) : remaining;
    const buy = Math.min(remaining, capacity);
    cost += buy * Number(cap.cost || 0);
    remaining -= buy;
  }
  return remaining > 0 ? Infinity : cost;
}

function maxInvestmentForBudget(budget, softCaps) {
  const limit = Math.max(0, Math.floor(Number(budget || 0)));
  let value = 0;
  while (characteristicInvestmentCost(value + 1, softCaps) <= limit) value++;
  return value;
}

function allocationKey(allocation = {}) {
  return [...ELEMENTS, 'vit'].map((key) => String(Math.max(0, Math.floor(Number(allocation[key] || 0)))).padStart(5, '0')).join('|');
}

function compareAllocationKeys(left, right) {
  return String(right || '').localeCompare(String(left || ''));
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

function nextMarginalCost(investment, softCaps) {
  return characteristicInvestmentCost(investment + 1, softCaps) - characteristicInvestmentCost(investment, softCaps);
}

function minimumCostForInitiative(lower, requiredTotalInvestment, softCaps) {
  const current = ELEMENTS.map((element) => Number(lower[element] || 0));
  let total = current.reduce((sum, value) => sum + value, 0);
  let cost = current.reduce((sum, value) => sum + characteristicInvestmentCost(value, softCaps), 0);
  while (total < requiredTotalInvestment) {
    let chosen = -1;
    let chosenCost = Infinity;
    for (let index = 0; index < current.length; index++) {
      const marginal = nextMarginalCost(current[index], softCaps);
      if (marginal < chosenCost) {
        chosen = index;
        chosenCost = marginal;
      }
    }
    if (chosen < 0 || !Number.isFinite(chosenCost)) return Infinity;
    current[chosen]++;
    total++;
    cost += chosenCost;
  }
  return cost;
}

function requestedMonoElements(elements) {
  return (elements || []).filter((element) => ELEMENTS.includes(element));
}

function scoreTableForElement({ stats, availableAp, element, profiles, critMode, minQ, maxQ, multi = false }) {
  const table = [];
  for (let q = minQ; q <= maxQ; q++) {
    const candidateStats = { ...stats, [element]: stat(stats, element) + q };
    const offense = evaluateSyntheticOffense({
      stats: candidateStats,
      availableAp,
      elements: multi ? ['multi'] : [element],
      profiles,
      critMode
    });
    if (multi) {
      const scores = offense.requestedProbes.flatMap((probe) => probe.lines
        .filter((line) => line.element === element)
        .map((line) => line.expectedValue * probe.equivalentProbeCount));
      table[q] = {
        minimum: scores.length ? Math.min(...scores) : 0,
        sum: scores.reduce((total, score) => total + score, 0)
      };
    } else {
      table[q] = {
        minimum: offense.minimumScore,
        sum: offense.requestedProbes.reduce((total, probe) => total + probe.totalApBudgetScore, 0)
      };
    }
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

function pairOptions(elements, minimums, maxQ, elementBudget, softCaps, contributionFor) {
  const [left, right] = elements;
  const options = [];
  for (let a = minimums[left]; a <= maxQ; a++) {
    const costA = characteristicInvestmentCost(a, softCaps);
    if (costA > elementBudget) break;
    for (let b = minimums[right]; b <= maxQ; b++) {
      const cost = costA + characteristicInvestmentCost(b, softCaps);
      if (cost > elementBudget) break;
      options.push({
        cost,
        totalQ: a + b,
        contribution: contributionFor(left, a) + contributionFor(right, b),
        values: [a, b]
      });
    }
  }
  return options;
}

function pairIsBetter(left, right) {
  if (right == null) return true;
  if (left.contribution > right.contribution + EPS) return true;
  if (left.contribution + EPS < right.contribution) return false;
  if (left.values[0] !== right.values[0]) return left.values[0] < right.values[0];
  return left.values[1] < right.values[1];
}

function fullCandidateIsBetter(left, right) {
  if (!right) return true;
  if (left.contribution > right.contribution + EPS) return true;
  if (left.contribution + EPS < right.contribution) return false;
  return compareAllocationKeys(left.key, right.key) > 0;
}

function optimizeSecondary({ minimums, elementBudget, requiredTotalQ, maxQ, softCaps, contributionFor, baseStats, scrolled, points }) {
  const first = pairOptions(['earth', 'fire'], minimums, maxQ, elementBudget, softCaps, contributionFor);
  const second = pairOptions(['water', 'air'], minimums, maxQ, elementBudget, softCaps, contributionFor);
  const maxPairQ = maxQ * 2;
  const width = maxPairQ + 2;
  const grid = new Int32Array((elementBudget + 1) * width);
  grid.fill(-1);
  const cell = (budget, q) => budget * width + q;

  for (let index = 0; index < second.length; index++) {
    const option = second[index];
    const position = cell(option.cost, option.totalQ);
    const previousIndex = grid[position];
    if (previousIndex < 0 || pairIsBetter(option, second[previousIndex])) grid[position] = index;
  }

  for (let budget = 1; budget <= elementBudget; budget++) {
    for (let q = 0; q <= maxPairQ; q++) {
      const position = cell(budget, q);
      const previousIndex = grid[cell(budget - 1, q)];
      if (previousIndex >= 0 && (grid[position] < 0 || pairIsBetter(second[previousIndex], second[grid[position]]))) {
        grid[position] = previousIndex;
      }
    }
  }

  for (let budget = 0; budget <= elementBudget; budget++) {
    for (let q = maxPairQ - 1; q >= 0; q--) {
      const position = cell(budget, q);
      const nextIndex = grid[cell(budget, q + 1)];
      if (nextIndex >= 0 && (grid[position] < 0 || pairIsBetter(second[nextIndex], second[grid[position]]))) {
        grid[position] = nextIndex;
      }
    }
  }

  let best = null;
  for (const option of first) {
    const remainingBudget = elementBudget - option.cost;
    if (remainingBudget < 0) continue;
    const requiredSecondQ = Math.max(0, requiredTotalQ - option.totalQ);
    if (requiredSecondQ > maxPairQ) continue;
    const secondIndex = grid[cell(remainingBudget, requiredSecondQ)];
    if (secondIndex < 0) continue;
    const mate = second[secondIndex];
    const elemental = {
      earth: option.values[0],
      fire: option.values[1],
      water: mate.values[0],
      air: mate.values[1]
    };
    const elementalCost = option.cost + mate.cost;
    const allocation = { ...elemental, vit: Math.max(0, points - elementalCost) };
    const candidate = {
      allocation,
      contribution: option.contribution + mate.contribution,
      key: allocationKey(allocation),
      stats: statsWithInvestment(baseStats, scrolled, allocation)
    };
    if (fullCandidateIsBetter(candidate, best)) best = candidate;
  }
  return best;
}

export function optimizeSyntheticCharacteristics({
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
} = {}) {
  const pointBudget = Math.max(0, Math.floor(Number(points || 0)));
  const baseWithScroll = statsWithInvestment(baseStats, scrolled, {});
  const minimums = hardElementLowerBounds(baseWithScroll, constraints, minimumStats);
  const minimumVitality = Math.max(0, Math.ceil(Number(constraints?.vit || 0) - stat(baseWithScroll, 'vit')));
  const elementBudget = pointBudget - minimumVitality;
  if (elementBudget < 0) return { feasible: false, reason: 'constraint' };

  const initiativeTarget = Math.max(0, Number(constraints?.initiative || 0));
  const requiredTotalQ = Math.max(0, Math.ceil(initiativeTarget - initiativeContribution(baseWithScroll)));
  const lowerCost = ELEMENTS.reduce((sum, element) => sum + characteristicInvestmentCost(minimums[element], softCaps), 0);
  if (!Number.isFinite(lowerCost) || lowerCost > elementBudget) return { feasible: false, reason: 'constraint' };
  if (minimumCostForInitiative(minimums, requiredTotalQ, softCaps) > elementBudget) {
    return { feasible: false, reason: 'constraint' };
  }

  const maxQ = maxInvestmentForBudget(elementBudget, softCaps);
  const requestProbe = evaluateSyntheticOffense({ stats: baseWithScroll, availableAp, elements, profiles, critMode });
  const isMulti = requestProbe.elements.length === 1 && requestProbe.elements[0] === 'multi';
  const optimizationElements = isMulti ? [...ELEMENTS] : requestedMonoElements(requestProbe.elements);
  const tables = {};

  for (const element of optimizationElements) {
    tables[element] = scoreTableForElement({
      stats: baseWithScroll,
      availableAp,
      element,
      profiles: requestProbe.profiles,
      critMode,
      minQ: minimums[element],
      maxQ,
      multi: isMulti
    });
  }

  const thresholds = [];
  for (const element of optimizationElements) {
    for (let q = minimums[element]; q <= maxQ; q++) thresholds.push(tables[element][q].minimum);
  }
  thresholds.sort((a, b) => a - b);
  const uniqueThresholds = thresholds.filter((value, index) => index === 0 || Math.abs(value - thresholds[index - 1]) > EPS);

  const minimumsForThreshold = (target) => {
    const resolved = { ...minimums };
    for (const element of optimizationElements) {
      const q = firstQMeeting(tables[element], minimums[element], maxQ, target);
      if (q == null) return null;
      resolved[element] = Math.max(resolved[element], q);
    }
    return resolved;
  };
  const thresholdFeasible = (target) => {
    const resolved = minimumsForThreshold(target);
    if (!resolved) return false;
    return minimumCostForInitiative(resolved, requiredTotalQ, softCaps) <= elementBudget;
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

  const requested = new Set(optimizationElements);
  const contributionFor = (element, q) => requested.has(element) ? Number(tables[element][q]?.sum || 0) : 0;
  const best = optimizeSecondary({
    minimums: scoreMinimums,
    elementBudget,
    requiredTotalQ,
    maxQ,
    softCaps,
    contributionFor,
    baseStats,
    scrolled,
    points: pointBudget
  });
  if (!best) return { feasible: false, reason: 'constraint' };
  const offense = evaluateSyntheticOffense({
    stats: best.stats,
    availableAp,
    elements: requestProbe.elements,
    profiles: requestProbe.profiles,
    critMode
  });
  return {
    feasible: true,
    stats: best.stats,
    allocation: best.allocation,
    minimumStats: { ...minimumStats },
    offense,
    deterministicAllocationKey: best.key,
    requiredTotalElementInvestmentForInitiative: requiredTotalQ
  };
}
