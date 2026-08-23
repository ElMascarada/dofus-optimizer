import { cloneStats } from './stats.js';
import { evaluateObjective } from './spells.js';

export const FM_ELIGIBLE_SLOTS = new Set(['hat', 'cape', 'amulet', 'ring', 'belt', 'boots', 'weapon', 'shield']);

function offensiveAssignmentOptions(items, policy) {
  const critEligible = items.filter((item) => Number(item.stats?.critDamage || 0) === 0);
  const forcedSpellPct = items.length - critEligible.length;
  const maxCritItems = policy.allowCritDamage ? critEligible.length : 0;
  return { critEligible, forcedSpellPct, maxCritItems };
}

function structuralPairs(forgeableItems, enabled) {
  if (!enabled) return [{ apItem: null, mpItem: null }];
  if (forgeableItems.length < 2) return [];
  const pairs = [];
  for (let apIndex = 0; apIndex < forgeableItems.length; apIndex++) {
    for (let mpIndex = 0; mpIndex < forgeableItems.length; mpIndex++) {
      if (apIndex === mpIndex) continue;
      pairs.push({ apItem: forgeableItems[apIndex], mpItem: forgeableItems[mpIndex] });
    }
  }
  return pairs;
}

export function optimizeFm({ baseStats, items, selections, turnMode, policy, scenario = {} }) {
  const forgeableItems = items.filter((item) => FM_ELIGIBLE_SLOTS.has(item.slot));
  const useStructuralExos = policy?.structuralExos === true;
  let best = null;

  for (const pair of structuralPairs(forgeableItems, useStructuralExos)) {
    const structuralIds = new Set([pair.apItem?.id, pair.mpItem?.id].filter(Boolean));
    const offensiveItems = forgeableItems.filter((item) => !structuralIds.has(item.id));
    const { critEligible, forcedSpellPct, maxCritItems } = offensiveAssignmentOptions(offensiveItems, policy);

    for (let critItems = 0; critItems <= maxCritItems; critItems++) {
      const stats = cloneStats(baseStats);
      if (pair.apItem) stats.ap = (stats.ap || 0) + 1;
      if (pair.mpItem) stats.mp = (stats.mp || 0) + 1;

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
          structuralExos: useStructuralExos ? 2 : 0,
          assignments: items.map((item) => {
            if (pair.apItem?.id === item.id) return { itemId: item.id, type: 'exoAp', value: 1 };
            if (pair.mpItem?.id === item.id) return { itemId: item.id, type: 'exoMp', value: 1 };
            if (!FM_ELIGIBLE_SLOTS.has(item.slot)) return { itemId: item.id, type: 'none', value: 0 };
            if (critIds.has(item.id)) return { itemId: item.id, type: 'critDamage', value: policy.critDamageAmount };
            return { itemId: item.id, type: 'spellDamagePct', value: policy.spellDamagePct };
          })
        };
      }
    }
  }

  return best;
}
