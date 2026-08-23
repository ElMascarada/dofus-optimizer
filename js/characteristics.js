import { ELEMENT_SOFT_CAPS } from './config.js';
import { cloneStats } from './stats.js';

function segmentsForElement(element, maxPoints = 995) {
  const segments = [];
  let remainingBudget = maxPoints;
  for (const cap of ELEMENT_SOFT_CAPS) {
    const amount = Number.isFinite(cap.amount) ? cap.amount : Math.floor(remainingBudget / cap.cost);
    if (amount <= 0) continue;
    segments.push({ element, amount, cost: cap.cost });
    remainingBudget -= amount * cap.cost;
    if (remainingBudget <= 0) break;
  }
  return segments;
}

export function optimizeCharacteristics(baseStats, options) {
  const {
    points = 995,
    scrolled = {},
    elementValues = {},
    minimumVitality = 0,
    baseVitality = 0
  } = options;

  const stats = cloneStats(baseStats);
  let budget = points;
  const allocation = { earth: 0, fire: 0, water: 0, air: 0, vit: 0 };

  for (const element of ['earth', 'fire', 'water', 'air']) {
    stats[element] = (stats[element] || 0) + (scrolled[element] || 0);
  }

  const missingVitality = Math.max(0, minimumVitality - ((stats.vit || 0) + baseVitality));
  const vitSpend = Math.min(budget, Math.ceil(missingVitality));
  if (vitSpend > 0) {
    allocation.vit += vitSpend;
    stats.vit = (stats.vit || 0) + vitSpend;
    budget -= vitSpend;
  }

  const allSegments = ['earth', 'fire', 'water', 'air']
    .flatMap((element) => segmentsForElement(element, points))
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

  return { stats, allocation, remainingPoints: budget };
}
