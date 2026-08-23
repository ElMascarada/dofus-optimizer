import { cloneStats } from './stats.js';
import { evaluateObjective } from './spells.js';

export const FM_ELIGIBLE_SLOTS = new Set(['hat', 'cape', 'amulet', 'ring', 'belt', 'boots', 'weapon', 'shield']);

export function optimizeFm({ baseStats, items, selections, turnMode, policy, scenario = {} }) {
  const forgeableItems = items.filter((item) => FM_ELIGIBLE_SLOTS.has(item.slot));
  const critEligible = forgeableItems.filter((item) => Number(item.stats?.critDamage || 0) === 0);
  const forcedSpellPct = forgeableItems.length - critEligible.length;
  const maxCritItems = policy.allowCritDamage ? critEligible.length : 0;
  let best = null;

  for (let critItems = 0; critItems <= maxCritItems; critItems++) {
    const stats = cloneStats(baseStats);
    const spellPctItems = forcedSpellPct + (critEligible.length - critItems);
    stats.spellDamagePct = (stats.spellDamagePct || 0) + spellPctItems * policy.spellDamagePct;
    stats.critDamage = (stats.critDamage || 0) + critItems * policy.critDamageAmount;

    const objective = evaluateObjective({ stats, items, selections, turnMode, scenario });
    if (!best || objective.score > best.objective.score) {
      const critIds = new Set(critEligible.slice(0, critItems).map((item) => item.id));
      best = {
        stats,
        objective,
        critItems,
        spellPctItems,
        assignments: items.map((item) => {
          if (!FM_ELIGIBLE_SLOTS.has(item.slot)) return { itemId: item.id, type: 'none', value: 0 };
          if (critIds.has(item.id)) return { itemId: item.id, type: 'critDamage', value: policy.critDamageAmount };
          return { itemId: item.id, type: 'spellDamagePct', value: policy.spellDamagePct };
        })
      };
    }
  }

  return best;
}
