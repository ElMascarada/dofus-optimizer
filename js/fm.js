import { cloneStats } from './stats.js';
import { evaluateObjective } from './spells.js';

export const FM_ELIGIBLE_SLOTS = new Set(['hat', 'cape', 'amulet', 'ring', 'belt', 'boots', 'weapon', 'shield']);

function offensiveAssignmentOptions(items, policy) {
  const critEligible = items.filter((item) => Number(item.stats?.critDamage || 0) === 0);
  const forcedSpellPctItems = items.filter((item) => Number(item.stats?.critDamage || 0) !== 0);
  const maxCritItems = policy.allowCritDamage ? critEligible.length : 0;
  return { critEligible, forcedSpellPctItems, maxCritItems };
}

function structuralExoSelection(policy = {}) {
  // Keep legacy structuralExos as an explicitly-requested compatibility input
  // for old deterministic callers. Product requests use the independent fields.
  const legacyPair = policy?.structuralExos === true;
  return {
    exoAp: Number(policy?.exoAp ?? (legacyPair ? 1 : 0)) === 1 ? 1 : 0,
    exoMp: Number(policy?.exoMp ?? (legacyPair ? 1 : 0)) === 1 ? 1 : 0
  };
}

function applyStructuralExos(stats, { exoAp = 0, exoMp = 0 } = {}) {
  if (exoAp) stats.ap = (stats.ap || 0) + 1;
  if (exoMp) stats.mp = (stats.mp || 0) + 1;
}

function noOffensiveFm({ baseStats, items, selections, turnMode, scenario, exoAp, exoMp }) {
  const stats = cloneStats(baseStats);
  applyStructuralExos(stats, { exoAp, exoMp });
  const objective = evaluateObjective({ stats, items, selections, turnMode, scenario });
  return {
    stats,
    objective,
    critItems: 0,
    spellPctItems: 0,
    structuralExos: exoAp + exoMp,
    exoAp,
    exoMp,
    assignments: items.map((item) => ({ itemId: item.id, type: 'none', value: 0 }))
  };
}

export function optimizeFm({ baseStats, items, selections, turnMode, policy = {}, scenario = {} }) {
  const forgeableItems = items.filter((item) => FM_ELIGIBLE_SLOTS.has(item.slot));
  const { exoAp, exoMp } = structuralExoSelection(policy);
  const spellDamagePct = Math.max(0, Number(policy?.spellDamagePct || 0));
  const allowCritDamage = policy?.allowCritDamage === true;

  if (spellDamagePct <= 0 && !allowCritDamage) {
    return noOffensiveFm({
      baseStats,
      items,
      selections,
      turnMode,
      scenario,
      exoAp,
      exoMp
    });
  }

  const normalizedPolicy = { ...policy, spellDamagePct, allowCritDamage };
  const { critEligible, forcedSpellPctItems, maxCritItems } = offensiveAssignmentOptions(forgeableItems, normalizedPolicy);
  let best = null;

  // Structural exos remain abstract permanent +1 bonuses and do not consume
  // offensive FM slots. They are now independent explicit user selections.
  for (let critItems = 0; critItems <= maxCritItems; critItems++) {
    const stats = cloneStats(baseStats);
    applyStructuralExos(stats, { exoAp, exoMp });

    const spellPctItems = spellDamagePct > 0
      ? forcedSpellPctItems.length + (critEligible.length - critItems)
      : 0;
    stats.spellDamagePct = (stats.spellDamagePct || 0) + spellPctItems * spellDamagePct;
    stats.critDamage = (stats.critDamage || 0) + critItems * Number(normalizedPolicy.critDamageAmount ?? 8);

    const objective = evaluateObjective({ stats, items, selections, turnMode, scenario });
    if (!best || objective.score > best.objective.score) {
      const critIds = new Set(critEligible.slice(0, critItems).map((item) => item.id));
      best = {
        stats,
        objective,
        critItems,
        spellPctItems,
        structuralExos: exoAp + exoMp,
        exoAp,
        exoMp,
        assignments: items.map((item) => {
          if (!FM_ELIGIBLE_SLOTS.has(item.slot)) return { itemId: item.id, type: 'none', value: 0 };
          if (critIds.has(item.id)) return { itemId: item.id, type: 'critDamage', value: Number(normalizedPolicy.critDamageAmount ?? 8) };
          if (spellDamagePct > 0) return { itemId: item.id, type: 'spellDamagePct', value: spellDamagePct };
          return { itemId: item.id, type: 'none', value: 0 };
        })
      };
    }
  }

  return best;
}
