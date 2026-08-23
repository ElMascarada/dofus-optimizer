import { addStats } from './stats.js';

export function applySetBonuses(stats, items, setsById = {}) {
  const counts = {};
  for (const item of items) {
    if (item.setId) counts[item.setId] = (counts[item.setId] || 0) + 1;
  }

  const active = [];
  for (const [setId, count] of Object.entries(counts)) {
    const set = setsById[setId];
    const bonus = set?.bonuses?.[String(count)];
    if (!bonus) continue;
    addStats(stats, bonus);
    active.push({ setId, name: set.name, count, bonus });
  }
  return active;
}
