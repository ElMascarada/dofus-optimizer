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

function hasNativeCritDamage(item) {
  return Number(item?.stats?.critDamage || 0) !== 0;
}

function chooseStructuralPair(forgeable = []) {
  // A native-Do-Crit item cannot receive the +8 Do Crit offensive FM anyway.
  // Putting PA/PM exos on those items first can therefore never reduce the
  // offensive FM option set. If fewer than two exist, fill deterministically
  // with the lowest-id remaining items.
  const nativeCrit = forgeable.filter(hasNativeCritDamage);
  const critEligible = forgeable.filter((item) => !hasNativeCritDamage(item));
  return [...nativeCrit, ...critEligible].slice(0, 2);
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

  const structuralPair = chooseStructuralPair(forgeable);
  const structuralIds = new Set(structuralPair.map(itemKey));
  const offensiveItems = forgeable.filter((item) => !structuralIds.has(itemKey(item)));
  const critEligible = offensiveItems.filter((item) => !hasNativeCritDamage(item));
  const forcedSpell = offensiveItems.filter(hasNativeCritDamage);

  // For synthetic scoring, assignments with the same number of +8 Do Crit
  // slots are mathematically equivalent: only aggregate spellDamagePct and
  // critDamage matter. Evaluate one canonical representative for each count
  // instead of 2^N item masks (at most 8 variants for the normal 7 slots).
  let best = null;
  for (let critCount = 0; critCount <= critEligible.length; critCount++) {
    const critIds = new Set(critEligible.slice(0, critCount).map(itemKey));
    const assignments = baseAssignments(items);
    assignments.set(itemKey(structuralPair[0]), { itemId: structuralPair[0].id, type: 'exoAp', value: 1 });
    assignments.set(itemKey(structuralPair[1]), { itemId: structuralPair[1].id, type: 'exoMp', value: 1 });

    for (const item of critEligible) {
      const useCrit = critIds.has(itemKey(item));
      assignments.set(itemKey(item), {
        itemId: item.id,
        type: useCrit ? 'critDamage' : 'spellDamagePct',
        value: useCrit ? normalized.critDamageAmount : normalized.spellDamagePct
      });
    }
    for (const item of forcedSpell) {
      assignments.set(itemKey(item), {
        itemId: item.id,
        type: 'spellDamagePct',
        value: normalized.spellDamagePct
      });
    }

    const spellPctItems = offensiveItems.length - critCount;
    const candidateStats = cloneStats(stats);
    candidateStats.spellDamagePct = Number(candidateStats.spellDamagePct || 0)
      + spellPctItems * normalized.spellDamagePct;
    candidateStats.critDamage = Number(candidateStats.critDamage || 0)
      + critCount * normalized.critDamageAmount;

    const offense = evaluateSyntheticOffense({
      stats: candidateStats,
      availableAp,
      elements,
      profiles
    });
    const assignmentList = [...assignments.values()];
    const key = assignmentKey(assignmentList);
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
        critItems: critCount,
        assignments: assignmentList
      };
    }
  }

  return best;
}
