import { compareSyntheticOffenseResults, evaluateSyntheticOffense } from './synthetic-offense.js';

export const SYNTHETIC_FM_ELIGIBLE_SLOTS = new Set([
  'hat', 'cape', 'amulet', 'ring', 'belt', 'boots', 'weapon', 'shield'
]);

export function syntheticFmEnabled(policy = {}) {
  return policy?.enabled === true || policy?.fmEnabled === true;
}

export function normalizeSyntheticFmPolicy(policy = {}) {
  const enabled = syntheticFmEnabled(policy);
  return {
    enabled,
    exoAp: enabled ? 1 : (Number(policy?.exoAp) === 1 ? 1 : 0),
    exoMp: enabled ? 1 : (Number(policy?.exoMp) === 1 ? 1 : 0),
    spellDamagePct: enabled ? 1 : 0,
    allowCritDamage: enabled,
    critDamageAmount: 8
  };
}

function cloneStats(stats = {}) {
  return { ...stats };
}

function itemKey(item) {
  return String(item?.id ?? '');
}

function pairKey(left, right) {
  return [itemKey(left), itemKey(right)].sort().join('|');
}

function combinationsOfTwo(items = []) {
  const output = [];
  for (let left = 0; left < items.length; left++) {
    for (let right = left + 1; right < items.length; right++) {
      output.push([items[left], items[right]]);
    }
  }
  return output;
}

function assignmentKey(assignments = []) {
  return assignments
    .map((entry) => `${entry.itemId}:${entry.type}:${entry.value}`)
    .sort()
    .join('|');
}

function baseAssignments(items = []) {
  return new Map((items || []).map((item) => [itemKey(item), {
    itemId: item?.id,
    type: 'none',
    value: 0
  }]));
}

function noOffensiveFm({ stats, items, availableAp, elements, profiles, policy }) {
  const normalized = normalizeSyntheticFmPolicy(policy);
  return {
    stats: cloneStats(stats),
    offense: evaluateSyntheticOffense({ stats, availableAp, elements, profiles }),
    enabled: false,
    structuralSlots: normalized.exoAp + normalized.exoMp,
    offensiveSlots: 0,
    exoAp: normalized.exoAp,
    exoMp: normalized.exoMp,
    spellPctItems: 0,
    critItems: 0,
    assignments: [...baseAssignments(items).values()]
  };
}

export function optimizeSyntheticFm({
  stats = {},
  items = [],
  availableAp = 0,
  elements = [],
  profiles = [],
  policy = {}
} = {}) {
  const normalized = normalizeSyntheticFmPolicy(policy);
  if (!normalized.enabled) {
    return noOffensiveFm({ stats, items, availableAp, elements, profiles, policy });
  }

  const forgeable = (items || [])
    .filter((item) => SYNTHETIC_FM_ELIGIBLE_SLOTS.has(item?.slot))
    .sort((a, b) => itemKey(a).localeCompare(itemKey(b)));

  if (forgeable.length < 2) {
    throw new RangeError('FM enabled requires at least two forgeable equipment slots for PA/PM exos');
  }

  let best = null;
  for (const structuralPair of combinationsOfTwo(forgeable)) {
    const structuralIds = new Set(structuralPair.map(itemKey));
    const offensiveItems = forgeable.filter((item) => !structuralIds.has(itemKey(item)));
    const critEligible = offensiveItems.filter((item) => Number(item?.stats?.critDamage || 0) === 0);
    const critIndex = new Map(critEligible.map((item, index) => [itemKey(item), index]));
    const variantCount = 2 ** critEligible.length;

    for (let mask = 0; mask < variantCount; mask++) {
      const candidateStats = cloneStats(stats);
      const assignments = baseAssignments(items);
      const sortedPair = [...structuralPair].sort((a, b) => itemKey(a).localeCompare(itemKey(b)));
      assignments.set(itemKey(sortedPair[0]), { itemId: sortedPair[0].id, type: 'exoAp', value: 1 });
      assignments.set(itemKey(sortedPair[1]), { itemId: sortedPair[1].id, type: 'exoMp', value: 1 });

      let critItems = 0;
      let spellPctItems = 0;
      for (const item of offensiveItems) {
        const index = critIndex.get(itemKey(item));
        const useCrit = index != null && ((mask >> index) & 1) === 1;
        if (useCrit) {
          critItems++;
          assignments.set(itemKey(item), {
            itemId: item.id,
            type: 'critDamage',
            value: normalized.critDamageAmount
          });
        } else {
          spellPctItems++;
          assignments.set(itemKey(item), {
            itemId: item.id,
            type: 'spellDamagePct',
            value: normalized.spellDamagePct
          });
        }
      }

      candidateStats.spellDamagePct = Number(candidateStats.spellDamagePct || 0)
        + spellPctItems * normalized.spellDamagePct;
      candidateStats.critDamage = Number(candidateStats.critDamage || 0)
        + critItems * normalized.critDamageAmount;

      const offense = evaluateSyntheticOffense({
        stats: candidateStats,
        availableAp,
        elements,
        profiles
      });
      const assignmentList = [...assignments.values()];
      const key = `${pairKey(...structuralPair)}|${assignmentKey(assignmentList)}`;
      const comparison = best ? compareSyntheticOffenseResults(offense, best.offense) : 1;
      if (!best || comparison > 0 || (comparison === 0 && key < best.key)) {
        best = {
          key,
          stats: candidateStats,
          offense,
          enabled: true,
          structuralSlots: 2,
          offensiveSlots: offensiveItems.length,
          exoAp: 1,
          exoMp: 1,
          spellPctItems,
          critItems,
          assignments: assignmentList
        };
      }
    }
  }

  return best;
}
