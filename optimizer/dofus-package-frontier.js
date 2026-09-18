import { addStats, effectiveStat, emptyStats } from '../js/stats.js';
import { specialSlotRulesAreValid } from '../js/build-legality.js';

const ELEMENTS = Object.freeze(['earth', 'fire', 'water', 'air']);
const ELEMENT_DAMAGE = Object.freeze({
  earth: 'damageEarth',
  fire: 'damageFire',
  water: 'damageWater',
  air: 'damageAir'
});
const ALWAYS_OFFENSE_KEYS = Object.freeze([
  'power',
  'damage',
  'spellDamagePct',
  'rangedDamagePct'
]);
const CRIT_OFFENSE_KEYS = Object.freeze([
  'crit',
  'critDamage'
]);
const STATIC_CONDITION_STATS = new Set(['ap', 'mp', 'setBonus', 'level']);

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

function collectConditionStats(node, output) {
  if (!node) return;
  if (node.kind === 'relation') {
    for (const child of node.children || []) collectConditionStats(child, output);
    return;
  }
  if (node.stat) output.add(String(node.stat));
}

export function dofusPackageDominanceKeys(syntheticOffense = {}, constraints = {}, pool = []) {
  const axes = requestedAxes(syntheticOffense);
  const critMode = String(syntheticOffense?.critMode || 'auto').trim().toLowerCase();
  const keys = new Set([
    ...ALWAYS_OFFENSE_KEYS,
    ...axes,
    ...axes.map((element) => ELEMENT_DAMAGE[element])
  ]);

  if (critMode !== 'no_crit') {
    for (const key of CRIT_OFFENSE_KEYS) keys.add(key);
  }

  for (const [key, minimum] of Object.entries(constraints || {})) {
    if (Number.isFinite(Number(minimum)) && Number(minimum) > 0) keys.add(key);
  }

  for (const item of pool || []) collectConditionStats(item?.conditions, keys);

  for (const key of STATIC_CONDITION_STATS) keys.delete(key);
  return [...keys].sort();
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
  const keys = dofusPackageDominanceKeys(syntheticOffense, constraints, pool);
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
