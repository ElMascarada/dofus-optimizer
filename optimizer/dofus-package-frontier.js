import { addStats, effectiveStat, emptyStats } from '../js/stats.js';
import { specialSlotRulesAreValid } from '../js/build-legality.js';

const ELEMENTS = Object.freeze(['earth', 'fire', 'water', 'air']);
const ELEMENT_DAMAGE = Object.freeze({
  earth: 'damageEarth',
  fire: 'damageFire',
  water: 'damageWater',
  air: 'damageAir'
});
const COMMON_KEYS = Object.freeze([
  'power',
  'damage',
  'crit',
  'critDamage',
  'spellDamagePct',
  'range'
]);

function unique(values = []) {
  return [...new Set((values || []).map((value) => String(value || '').trim().toLowerCase()).filter(Boolean))];
}

function requestedAxes(syntheticOffense = {}) {
  const raw = unique(syntheticOffense?.elements);
  if (raw.includes('multi')) return [...ELEMENTS];
  return raw.filter((element) => ELEMENTS.includes(element));
}

function itemKey(items = []) {
  return (items || []).map((item) => String(item?.id ?? '')).sort().join('|');
}

function dominanceKeys(syntheticOffense = {}, constraints = {}) {
  const axes = requestedAxes(syntheticOffense);
  return [...new Set([
    ...COMMON_KEYS,
    ...axes,
    ...axes.map((element) => ELEMENT_DAMAGE[element]),
    ...Object.entries(constraints || {})
      .filter(([, minimum]) => Number.isFinite(Number(minimum)) && Number(minimum) > 0)
      .map(([key]) => key)
      .filter((key) => !['ap', 'mp'].includes(key))
  ])];
}

function conditionSignature(items = []) {
  const conditions = items
    .map((item) => item?.conditions || null)
    .map((condition) => JSON.stringify(condition))
    .sort();
  return JSON.stringify(conditions);
}

function packageStats(items = []) {
  const stats = emptyStats();
  for (const item of items) addStats(stats, item?.stats || {});
  return { ...stats };
}

function dominates(left, right, keys) {
  let strictlyBetter = false;
  for (const key of keys) {
    const lv = effectiveStat(left, key);
    const rv = effectiveStat(right, key);
    if (lv < rv) return false;
    if (lv > rv) strictlyBetter = true;
  }
  return strictlyBetter;
}

function sameVector(left, right, keys) {
  return keys.every((key) => effectiveStat(left, key) === effectiveStat(right, key));
}

function insertFrontier(frontier, candidate, keys) {
  for (const existing of frontier) {
    if (dominates(existing.stats, candidate.stats, keys) || sameVector(existing.stats, candidate.stats, keys)) {
      return false;
    }
  }
  for (let index = frontier.length - 1; index >= 0; index--) {
    if (dominates(candidate.stats, frontier[index].stats, keys)) frontier.splice(index, 1);
  }
  frontier.push(candidate);
  return true;
}

export function buildDofusPackageFrontier(pool = [], {
  syntheticOffense = {},
  constraints = {}
} = {}) {
  const keys = dominanceKeys(syntheticOffense, constraints);
  const buckets = new Map();
  let combinations = 0;
  let legalCombinations = 0;
  const items = [...pool];

  function visit(start, chosen) {
    if (chosen.length === 6) {
      combinations++;
      if (!specialSlotRulesAreValid(chosen)) return;
      legalCombinations++;

      const stats = packageStats(chosen);
      const ap = effectiveStat(stats, 'ap');
      const mp = effectiveStat(stats, 'mp');
      const bucket = `${ap}:${mp}:${conditionSignature(chosen)}`;
      if (!buckets.has(bucket)) buckets.set(bucket, []);
      insertFrontier(buckets.get(bucket), {
        id: itemKey(chosen),
        items: [...chosen],
        stats,
        ap,
        mp
      }, keys);
      return;
    }

    const remaining = 6 - chosen.length;
    for (let index = start; index <= items.length - remaining; index++) {
      chosen.push(items[index]);
      visit(index + 1, chosen);
      chosen.pop();
    }
  }

  visit(0, []);
  return {
    combinations,
    legalCombinations,
    packages: [...buckets.values()].flat(),
    dominanceKeys: keys
  };
}
