import { FM_ELIGIBLE_SLOTS } from './fm.js';
import { applyPassiveModifiers } from './passives.js';
import { addStats, constraintStatContribution, stat } from './stats.js';

const OBJECTIVE_COMMON_STATS = [
  'power', 'damage', 'crit', 'critDamage', 'spellDamagePct',
  'finalDamagePct', 'finalDamagePctT1', 'finalDamagePctT2', 'finalDamagePctT3'
];

const ELEMENT_DAMAGE_STAT = {
  earth: 'damageEarth',
  neutral: 'damageNeutral',
  fire: 'damageFire',
  water: 'damageWater',
  air: 'damageAir'
};

function walkCondition(node, visit) {
  if (!node) return;
  if (node.kind === 'relation') {
    for (const child of node.children || []) walkCondition(child, visit);
    return;
  }
  visit(node);
}

export function collectConditionStatInfo(items = []) {
  const all = new Set();
  const nonMonotone = new Set();
  for (const item of items) {
    walkCondition(item?.conditions, (condition) => {
      const key = condition?.stat;
      if (!key || key === 'level' || key === 'setBonus') return;
      all.add(key);
      if (['lt', 'lte', 'eq', 'neq'].includes(condition.operator)) nonMonotone.add(key);
    });
  }
  return { all, nonMonotone };
}

export function relevantStatKeys({ items = [], selections = [], constraints = {} } = {}) {
  const keys = new Set(Object.keys(constraints || {}));
  for (const key of OBJECTIVE_COMMON_STATS) keys.add(key);

  for (const selection of selections || []) {
    if (!selection?.enabled) continue;
    const spell = selection.spell || {};
    for (const hit of spell.hits || []) {
      const element = hit.element || 'earth';
      keys.add(element === 'neutral' ? 'earth' : element);
      keys.add(ELEMENT_DAMAGE_STAT[element] || 'damageEarth');
    }
  }

  const conditionInfo = collectConditionStatInfo(items);
  for (const key of conditionInfo.all) keys.add(key);
  keys.delete('level');
  keys.delete('setBonus');
  return { keys: [...keys].sort(), nonMonotoneKeys: conditionInfo.nonMonotone };
}

function addPositive(target, key, value, mode = 'sum') {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return;
  if (mode === 'max') target[key] = Math.max(Number(target[key] || 0), number);
  else target[key] = Number(target[key] || 0) + number;
}

function selectedTurnsForMode(mode) {
  if (mode === 't1') return [1];
  if (mode === 't2') return [2];
  if (mode === 't3') return [3];
  return [1, 2, 3];
}

function scenarioContextForTurn(scenario = {}, turn = 1) {
  const shared = { ...scenario };
  delete shared.turns;
  delete shared.defaults;
  return { ...(scenario.defaults || {}), ...shared, ...(scenario.turns?.[turn] || {}), turn };
}

function staticPassiveUpperStats(item = {}) {
  const stats = {};
  let bounded = true;

  for (const passive of item.passives || []) {
    for (const rule of passive.rules || []) {
      for (const [key, value] of Object.entries(rule.stats || {})) addPositive(stats, key, value);
      for (const scaled of rule.scaledStats || []) {
        if (!Number.isFinite(scaled.max)) {
          bounded = false;
          continue;
        }
        const amount = Number(scaled.max) * Number(scaled.multiplier ?? 1) + Number(scaled.offset ?? 0);
        addPositive(stats, scaled.stat, amount);
      }
    }
  }

  for (const bonus of Object.values(item.turnBonuses || {})) {
    for (const [key, value] of Object.entries(bonus || {})) addPositive(stats, key, value);
  }
  return { stats, bounded };
}

function scenarioPassiveUpperStats(item = {}, { turnMode = 'sum', scenario = {} } = {}) {
  const stats = {};
  const passives = item.passives || [];

  for (const turn of selectedTurnsForMode(turnMode)) {
    const result = applyPassiveModifiers({}, passives, scenarioContextForTurn(scenario, turn));
    if (result.unresolved?.length) return null;

    const turnStats = { ...result.stats };
    addStats(turnStats, item.turnBonuses?.[turn] || {});
    for (const [key, value] of Object.entries(turnStats)) addPositive(stats, key, value, 'max');
  }

  return { stats, bounded: true };
}

export function passiveUpperStats(item = {}, { turnMode = null, scenario = null } = {}) {
  if (turnMode && scenario !== null) {
    const scenarioBound = scenarioPassiveUpperStats(item, { turnMode, scenario });
    if (scenarioBound) return scenarioBound;
  }
  return staticPassiveUpperStats(item);
}

export function optimisticItemStats(item = {}, {
  includePassives = false,
  turnMode = null,
  scenario = null
} = {}) {
  const result = {};
  for (const [key, value] of Object.entries(item.stats || {})) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) result[key] = number;
  }
  let bounded = true;
  if (includePassives) {
    const passive = passiveUpperStats(item, { turnMode, scenario });
    bounded = passive.bounded;
    for (const [key, value] of Object.entries(passive.stats)) result[key] = (result[key] || 0) + value;
  }
  return { stats: result, bounded };
}

function stableJson(value) {
  if (value == null) return '';
  return JSON.stringify(value);
}

function structuralSignature(item, nonMonotoneKeys) {
  const equalityStats = {};
  for (const key of nonMonotoneKeys || []) equalityStats[key] = constraintStatContribution(item.stats, key);
  return stableJson({
    slot: item.slot || null,
    slotSubtype: item.slotSubtype || null,
    setId: item.setId || null,
    conditions: item.conditions || null,
    passives: item.passives || [],
    turnBonuses: item.turnBonuses || null,
    nativeCritDamage: FM_ELIGIBLE_SLOTS.has(item.slot) ? stat(item.stats, 'critDamage') !== 0 : null,
    weaponType: item.slot === 'weapon' ? item.typeName || null : null,
    equalityStats
  });
}

function vectorSignature(item, keys) {
  return keys.map((key) => constraintStatContribution(item.stats, key)).join('|');
}

function dominates(a, b, keys) {
  let strictlyBetter = false;
  for (const key of keys) {
    const av = constraintStatContribution(a.stats, key);
    const bv = constraintStatContribution(b.stats, key);
    if (av < bv) return false;
    if (av > bv) strictlyBetter = true;
  }
  return strictlyBetter;
}

function maxSelectableForItem(item, groupCount) {
  return item?.slotSubtype === 'prysmaradite' ? 1 : Math.max(1, Number(groupCount || 1));
}

export function pruneDominatedCandidates(candidates = [], {
  keys = [],
  nonMonotoneKeys = new Set(),
  groupCount = 1
} = {}) {
  const partitions = new Map();
  for (const item of candidates) {
    const signature = structuralSignature(item, nonMonotoneKeys);
    if (!partitions.has(signature)) partitions.set(signature, []);
    partitions.get(signature).push(item);
  }

  const kept = [];
  let equivalentRemoved = 0;
  let dominatedRemoved = 0;

  for (const partition of partitions.values()) {
    const byVector = new Map();
    for (const item of partition) {
      const signature = vectorSignature(item, keys);
      if (!byVector.has(signature)) byVector.set(signature, []);
      byVector.get(signature).push(item);
    }

    const collapsed = [];
    for (const equivalent of byVector.values()) {
      const limit = Math.min(equivalent.length, maxSelectableForItem(equivalent[0], groupCount));
      collapsed.push(...equivalent.slice(0, limit));
      equivalentRemoved += equivalent.length - limit;
    }

    for (const candidate of collapsed) {
      const requiredDominators = maxSelectableForItem(candidate, groupCount);
      let dominators = 0;
      for (const other of collapsed) {
        if (other === candidate) continue;
        if (dominates(other, candidate, keys)) {
          dominators++;
          if (dominators >= requiredDominators) break;
        }
      }
      if (dominators >= requiredDominators) dominatedRemoved++;
      else kept.push(candidate);
    }
  }

  return {
    candidates: kept,
    removed: candidates.length - kept.length,
    equivalentRemoved,
    dominatedRemoved
  };
}

function insertTop(values, value, limit) {
  if (!(value > 0)) return values;
  const next = values.slice();
  let index = next.findIndex((entry) => value > entry);
  if (index < 0) index = next.length;
  next.splice(index, 0, value);
  if (next.length > limit) next.length = limit;
  return next;
}

function topSums(values, limit) {
  const sums = new Array(limit + 1).fill(0);
  for (let count = 1; count <= limit; count++) sums[count] = sums[count - 1] + Number(values[count - 1] || 0);
  return sums;
}

export function buildSuffixCaps(candidates = [], count = 1, keys = [], {
  includePassives = false,
  turnMode = null,
  scenario = null
} = {}) {
  const n = candidates.length;
  const caps = Object.fromEntries(keys.map((key) => [key, new Array(n + 1)]));
  const tops = Object.fromEntries(keys.map((key) => [key, []]));
  let bounded = true;

  for (const key of keys) caps[key][n] = new Array(count + 1).fill(0);
  for (let index = n - 1; index >= 0; index--) {
    const optimistic = optimisticItemStats(candidates[index], { includePassives, turnMode, scenario });
    bounded = bounded && optimistic.bounded;
    for (const key of keys) {
      tops[key] = insertTop(tops[key], Number(optimistic.stats[key] || 0), count);
      caps[key][index] = topSums(tops[key], count);
    }
  }

  return {
    bounded,
    cap(key, start = 0, picks = count) {
      const table = caps[key];
      if (!table) return 0;
      const row = table[Math.max(0, Math.min(n, start))] || [];
      return Number(row[Math.max(0, Math.min(count, picks))] || 0);
    }
  };
}

export function theoreticalChoiceCount(candidateCount, pickCount) {
  let n = BigInt(Math.max(0, candidateCount));
  let k = BigInt(Math.max(0, Math.min(candidateCount, pickCount)));
  if (k > n - k) k = n - k;
  let value = 1n;
  for (let i = 1n; i <= k; i++) value = (value * (n - k + i)) / i;
  return value;
}
