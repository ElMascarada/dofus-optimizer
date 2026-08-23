import { FM_ELIGIBLE_SLOTS } from './fm.js';
import { applyPassiveModifiers } from './passives.js';
import { addStats, stat } from './stats.js';

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
  for (const key of nonMonotoneKeys || []) equalityStats[key] = stat(item.stats, key);
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
  return keys.map((key) => stat(item.stats, key)).join('|');
}

function dominates(a, b, keys) {
  let strictlyBetter = false;
  for (const key of keys) {
    const av = stat(a.stats, key);
    const bv = stat(b.stats, key);
    if (av < bv) return false;
    if (av > bv) strictlyBetter = true;
  }
  return strictlyBetter;
}

export function pruneDominatedCandidates(items = [], { keys = [], nonMonotoneKeys = new Set(), groupCount = 1 } = {}) {
  const structuralGroups = new Map();
  for (const item of items) {
    const signature = structuralSignature(item, nonMonotoneKeys);
    if (!structuralGroups.has(signature)) structuralGroups.set(signature, []);
    structuralGroups.get(signature).push(item);
  }

  const keep = new Set();
  let equivalentRemoved = 0;
  let dominatedRemoved = 0;
  for (const group of structuralGroups.values()) {
    const byVector = new Map();
    for (const item of group) {
      const signature = vectorSignature(item, keys);
      if (!byVector.has(signature)) byVector.set(signature, []);
      byVector.get(signature).push(item);
    }

    const representatives = [];
    for (const same of byVector.values()) {
      const sorted = [...same].sort((a, b) => String(a.id).localeCompare(String(b.id)));
      const amount = Math.min(groupCount, sorted.length);
      representatives.push(...sorted.slice(0, amount));
      equivalentRemoved += Math.max(0, sorted.length - amount);
    }

    for (let i = 0; i < representatives.length; i++) {
      const candidate = representatives[i];
      let dominated = false;
      for (let j = 0; j < representatives.length; j++) {
        if (i === j) continue;
        if (dominates(representatives[j], candidate, keys)) {
          dominated = true;
          break;
        }
      }
      if (dominated) dominatedRemoved++;
      else keep.add(candidate.id);
    }
  }

  const candidates = items.filter((item) => keep.has(item.id));
  return {
    candidates,
    removed: items.length - candidates.length,
    equivalentRemoved,
    dominatedRemoved
  };
}

function positiveStats(item, keys, options) {
  const source = optimisticItemStats(item, options).stats;
  const result = {};
  for (const key of keys) result[key] = Math.max(0, stat(source, key));
  return result;
}

export function buildSuffixCaps(candidates, maxPicks, keys, options = {}) {
  const stats = candidates.map((item) => positiveStats(item, keys, options));
  const bounded = candidates.every((item) => optimisticItemStats(item, options).bounded);
  return {
    bounded,
    cap(key, start, picksLeft) {
      const values = [];
      for (let index = Math.max(0, start); index < stats.length; index++) {
        const value = Number(stats[index]?.[key] || 0);
        if (value > 0) values.push(value);
      }
      values.sort((a, b) => b - a);
      return values.slice(0, Math.min(maxPicks, Math.max(0, picksLeft))).reduce((sum, value) => sum + value, 0);
    }
  };
}

export function theoreticalChoiceCount(candidateCount, pickCount) {
  const n = BigInt(Math.max(0, Number(candidateCount || 0)));
  let k = BigInt(Math.max(0, Number(pickCount || 0)));
  if (k > n) return 0n;
  if (k > n - k) k = n - k;
  let result = 1n;
  for (let i = 1n; i <= k; i++) result = (result * (n - k + i)) / i;
  return result;
}
