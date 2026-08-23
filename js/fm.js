import { cloneStats } from './stats.js';
import { evaluateObjective } from './spells.js';

export const FM_ELIGIBLE_SLOTS = new Set(['hat', 'cape', 'amulet', 'ring', 'belt', 'boots', 'weapon', 'shield']);

function offensiveAssignmentOptions(items, policy) {
  const critEligible = items.filter((item) => Number(item.stats?.critDamage || 0) === 0);
  const forcedSpellPctItems = items.filter((item) => Number(item.stats?.critDamage || 0) !== 0);
  const maxCritItems = policy.allowCritDamage ? critEligible.length : 0;
  return { critEligible, forcedSpellPctItems, maxCritItems };
}

function structuralProfiles(forgeableItems, enabled) {
  if (!enabled) {
    return [{
      apItem: null,
      mpItem: null,
      offensiveItems: forgeableItems
    }];
  }
  if (forgeableItems.length < 2) return [];

  // Structural PA/PM exos consume two FM slots. For damage evaluation, the
  // exact item carrying PA versus PM is irrelevant: only the type of offensive
  // FM that gets sacrificed matters. Items with base crit damage can only take
  // % spell damage, while the others may take % spell damage or +crit damage.
  // Therefore there are at most three distinct structural cases instead of
  // N * (N - 1) ordered PA/PM placements on every evaluated build.
  const critEligible = forgeableItems.filter((item) => Number(item.stats?.critDamage || 0) === 0);
  const forcedSpellPctItems = forgeableItems.filter((item) => Number(item.stats?.critDamage || 0) !== 0);
  const profiles = [];

  for (let sacrificedCrit = 0; sacrificedCrit <= 2; sacrificedCrit++) {
    const sacrificedSpellPct = 2 - sacrificedCrit;
    if (sacrificedCrit > critEligible.length || sacrificedSpellPct > forcedSpellPctItems.length) continue;

    const structuralItems = [
      ...critEligible.slice(0, sacrificedCrit),
      ...forcedSpellPctItems.slice(0, sacrificedSpellPct)
    ];
    if (structuralItems.length !== 2) continue;

    const structuralIds = new Set(structuralItems.map((item) => item.id));
    profiles.push({
      apItem: structuralItems[0],
      mpItem: structuralItems[1],
      offensiveItems: forgeableItems.filter((item) => !structuralIds.has(item.id))
    });
  }

  return profiles;
}

export function optimizeFm({ baseStats, items, selections, turnMode, policy, scenario = {} }) {
  const forgeableItems = items.filter((item) => FM_ELIGIBLE_SLOTS.has(item.slot));
  const useStructuralExos = policy?.structuralExos === true;
  let best = null;

  for (const profile of structuralProfiles(forgeableItems, useStructuralExos)) {
    const { critEligible, forcedSpellPctItems, maxCritItems } = offensiveAssignmentOptions(profile.offensiveItems, policy);

    for (let critItems = 0; critItems <= maxCritItems; critItems++) {
      const stats = cloneStats(baseStats);
      if (profile.apItem) stats.ap = (stats.ap || 0) + 1;
      if (profile.mpItem) stats.mp = (stats.mp || 0) + 1;

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
            if (profile.apItem?.id === item.id) return { itemId: item.id, type: 'exoAp', value: 1 };
            if (profile.mpItem?.id === item.id) return { itemId: item.id, type: 'exoMp', value: 1 };
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
