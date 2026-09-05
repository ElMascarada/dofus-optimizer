import { ELEMENT_SOFT_CAPS } from './config.js';
import { cloneStats } from './stats.js';

const ELEMENTS = Object.freeze(['earth', 'fire', 'water', 'air']);

function segmentsForElement(element, maxPoints = 995, alreadyBought = 0) {
  const segments = [];
  let remainingBudget = maxPoints;
  let skip = Math.max(0, Number(alreadyBought || 0));
  for (const cap of ELEMENT_SOFT_CAPS) {
    const amount = Number.isFinite(cap.amount) ? cap.amount : Math.floor(remainingBudget / cap.cost);
    if (amount <= 0) continue;
    const skipped = Math.min(skip, amount);
    skip -= skipped;
    const available = amount - skipped;
    if (available > 0) segments.push({ element, amount: available, cost: cap.cost });
    remainingBudget -= amount * cap.cost;
    if (remainingBudget <= 0) break;
  }
  return segments;
}

function characteristicCost(amount = 0) {
  let remaining = Math.max(0, Math.floor(Number(amount || 0)));
  let cost = 0;
  for (const cap of ELEMENT_SOFT_CAPS) {
    if (remaining <= 0) break;
    const capacity = Number.isFinite(cap.amount) ? cap.amount : remaining;
    const buy = Math.min(remaining, capacity);
    cost += buy * cap.cost;
    remaining -= buy;
  }
  return remaining > 0 ? Infinity : cost;
}

// Safe Initiative feasibility bound: maximize the total number of elemental
// characteristic points obtainable with the real soft-cap schedule. Initiative
// benefits from the sum of all four elements, so the optimal upper bound buys
// the cheapest available segments across elements first.
export function maximumElementalCharacteristicGain(points = 995) {
  let budget = Math.max(0, Math.floor(Number(points || 0)));
  if (!budget) return 0;
  const segments = ELEMENTS
    .flatMap((element) => segmentsForElement(element, budget, 0))
    .map((segment, order) => ({ ...segment, order }))
    .sort((a, b) => a.cost - b.cost || a.order - b.order);
  let gain = 0;
  for (const segment of segments) {
    if (budget < segment.cost) break;
    const buy = Math.min(segment.amount, Math.floor(budget / segment.cost));
    gain += buy;
    budget -= buy * segment.cost;
  }
  return gain;
}

export function optimizeCharacteristics(baseStats, options) {
  const {
    points = 995,
    scrolled = {},
    elementValues = {},
    minimumVitality = 0,
    baseVitality = 0,
    minimumStats = {}
  } = options;

  const stats = cloneStats(baseStats);
  let budget = points;
  const allocation = { earth: 0, fire: 0, water: 0, air: 0, vit: 0 };

  for (const element of ELEMENTS) {
    stats[element] = (stats[element] || 0) + (scrolled[element] || 0);
  }

  const missingVitality = Math.max(0, minimumVitality - ((stats.vit || 0) + baseVitality));
  const vitSpend = Math.min(budget, Math.ceil(missingVitality));
  if (vitSpend > 0) {
    allocation.vit += vitSpend;
    stats.vit = (stats.vit || 0) + vitSpend;
    budget -= vitSpend;
  }

  // Reserve characteristic points for equipment conditions before optimizing
  // damage. Equipment stats and scroll are already present in `stats`, while
  // soft-cap costs apply only to the points actually invested here.
  let requirementsSatisfied = true;
  for (const element of ELEMENTS) {
    const target = Math.max(0, Number(minimumStats?.[element] || 0));
    const missing = Math.max(0, Math.ceil(target - Number(stats[element] || 0)));
    if (!missing) continue;
    const cost = characteristicCost(missing);
    if (!Number.isFinite(cost) || cost > budget) {
      requirementsSatisfied = false;
      continue;
    }
    allocation[element] += missing;
    stats[element] = (stats[element] || 0) + missing;
    budget -= cost;
  }

  const allSegments = ELEMENTS
    .flatMap((element) => segmentsForElement(element, points, allocation[element]))
    .map((segment, order) => ({
      ...segment,
      order,
      efficiency: (elementValues[segment.element] || 0) / segment.cost
    }))
    .sort((a, b) => b.efficiency - a.efficiency || a.cost - b.cost || a.order - b.order);

  for (const segment of allSegments) {
    if (budget < segment.cost || segment.efficiency <= 0) continue;
    const buy = Math.min(segment.amount, Math.floor(budget / segment.cost));
    allocation[segment.element] += buy;
    stats[segment.element] = (stats[segment.element] || 0) + buy;
    budget -= buy * segment.cost;
  }

  if (budget > 0) {
    allocation.vit += budget;
    stats.vit = (stats.vit || 0) + budget;
    budget = 0;
  }

  return { stats, allocation, remainingPoints: budget, requirementsSatisfied };
}
