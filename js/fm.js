import { cloneStats } from './stats.js';
import { evaluateObjective } from './spells.js';

export const FM_ELIGIBLE_SLOTS = new Set(['hat', 'cape', 'amulet', 'ring', 'belt', 'boots', 'weapon', 'shield']);

function offensiveAssignmentOptions(items, policy) {
  const critEligible = items.filter((item) => Number(item.stats?.critDamage || 0) === 0);
  const forcedSpellPctItems = items.filter((item) => Number(item.stats?.critDamage || 0) !== 0);
  const maxCritItems = policy.allowCritDamage ? critEligible.length : 0;
  return { critEligible, forcedSpellPctItems, maxCritItems };
}

function noOffensiveFm({ baseStats, items, selections, turnMode, scenario, structuralExos }) {
  const stats = cloneStats(baseStats);
  if (structuralExos) {
    stats.ap = (stats.ap || 0) + 1;
    stats.mp = (stats.mp || 0) + 1;
  }
  const objective = evaluateObjective({ stats, items, selections, turnMode, scenario });
  return {
    stats,
    objective,
    critItems: 0,
    spellPctItems: 0,
    structuralExos: structuralExos ? 2 : 0,
    assignments: items.map((item) => ({ itemId: item.id, type: 'none', value: 0 }))
  };
}

export function optimizeFm({ baseStats, items, selections, turnMode, policy, scenario = {} }) {
  const forgeableItems = items.filter((item) => FM_ELIGIBLE_SLOTS.has(item.slot));
  const useStructuralExos = policy?.structuralExos === true;
  const spellDamagePct = Math.max(0, Number(policy?.spellDamagePct || 0));

  // "Aucun" means exactly that: no % Do sorts and no +8 Do Crit. The crit
  // alternative only exists when an offensive FM percentage is selected.
  if (spellDamagePct <= 0) {
    return noOffensiveFm({
      baseStats,
      items,
      selections,
      turnMode,
      scenario,
      structuralExos: useStructuralExos
    });
  }

  const normalizedPolicy = { ...policy, spellDamagePct };
  const { critEligible, forcedSpellPctItems, maxCritItems } = offensiveAssignmentOptions(forgeableItems, normalizedPolicy);
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
    stats.spellDamagePct = (stats.spellDamagePct || 0) + spellPctItems * normalizedPolicy.spellDamagePct;
    stats.critDamage = (stats.critDamage || 0) + critItems * Number(normalizedPolicy.critDamageAmount ?? 8);

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
          if (critIds.has(item.id)) return { itemId: item.id, type: 'critDamage', value: Number(normalizedPolicy.critDamageAmount ?? 8) };
          return { itemId: item.id, type: 'spellDamagePct', value: normalizedPolicy.spellDamagePct };
        })
      };
    }
  }

  return best;
}
