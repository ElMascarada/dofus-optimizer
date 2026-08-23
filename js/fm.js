import { cloneStats } from './stats.js';
import { evaluateObjective } from './spells.js';

export function optimizeFm({ baseStats, items, selections, turnMode, policy }) {
  const eligible = items.filter((item) => Number(item.stats?.critDamage || 0) === 0);
  const forcedSpellPct = items.length - eligible.length;
  const maxCritItems = policy.allowCritDamage ? eligible.length : 0;
  let best = null;

  for (let critItems = 0; critItems <= maxCritItems; critItems++) {
    const stats = cloneStats(baseStats);
    const spellPctItems = forcedSpellPct + (eligible.length - critItems);
    stats.spellDamagePct = (stats.spellDamagePct || 0) + spellPctItems * policy.spellDamagePct;
    stats.critDamage = (stats.critDamage || 0) + critItems * policy.critDamageAmount;

    const objective = evaluateObjective({ stats, items, selections, turnMode });
    if (!best || objective.score > best.objective.score) {
      best = {
        stats,
        objective,
        critItems,
        spellPctItems,
        assignments: items.map((item, index) => {
          const isEligible = Number(item.stats?.critDamage || 0) === 0;
          if (isEligible && eligible.indexOf(item) < critItems) {
            return { itemId: item.id, type: 'critDamage', value: policy.critDamageAmount };
          }
          return { itemId: item.id, type: 'spellDamagePct', value: policy.spellDamagePct };
        })
      };
    }
  }

  return best;
}
