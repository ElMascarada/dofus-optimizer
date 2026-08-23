import { cloneStats } from './stats.js';
import { evaluateObjective } from './spells.js';

export const FM_ELIGIBLE_SLOTS = new Set(['hat', 'cape', 'amulet', 'ring', 'belt', 'boots', 'weapon', 'shield']);

function offensiveAssignmentOptions(items, policy) {
  const critEligible = items.filter((item) => Number(item.stats?.critDamage || 0) === 0);
  const forcedSpellPctItems = items.filter((item) => Number(item.stats?.critDamage || 0) !== 0);
  const maxCritItems = policy.allowCritDamage ? critEligible.length : 0;
  return { critEligible, forcedSpellPctItems, maxCritItems };
}

export function optimizeFm({ baseStats, items, selections, turnMode, policy, scenario = {} }) {
  const forgeableItems = items.filter((item) => FM_ELIGIBLE_SLOTS.has(item.slot));
  const useStructuralExos = policy?.structuralExos === true;
  const { critEligible, forcedSpellPctItems, maxCritItems } = offensiveAssignmentOptions(forgeableItems, policy);
  let best = null;

  // Performance approximation: PA/PM exos are modeled as +1 AP/+1 MP permanent
  // base bonuses and do not consume offensive FM slots. This avoids testing all
  // possible exo placements on every complete build. The resulting offensive
  // score is slightly optimistic, but the ranking remains useful and the search
  // stays fast enough for interactive use.
  for (let critItems = 0; critItems <= maxCritItems; critItems++) {
    const stats = cloneStats(baseStats);
    if (useStructuralExos) {
      stats.ap = (stats.ap || 0) + 1;
      stats.mp = (stats.mp || 0) + 1;
    }

    const spellPctItems = forcedSpellPctItems.length + (critEligible.length - critItems);
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
        structuralExos: useStructuralExos ? 2 : 0,
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
