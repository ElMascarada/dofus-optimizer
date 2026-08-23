import { addStats, cloneStats, stat } from './stats.js';
import { applyPassiveModifiers } from './passives.js';

const ELEMENT_STAT = {
  earth: 'earth',
  neutral: 'earth',
  fire: 'fire',
  water: 'water',
  air: 'air'
};

const FLAT_DAMAGE_STAT = {
  earth: 'damageEarth',
  neutral: 'damageNeutral',
  fire: 'damageFire',
  water: 'damageWater',
  air: 'damageAir'
};

function midpoint(range) {
  if (Array.isArray(range)) return (Number(range[0]) + Number(range[1])) / 2;
  return Number(range || 0);
}

function scenarioContextForTurn(scenario = {}, turn = 1) {
  const shared = { ...scenario };
  delete shared.turns;
  delete shared.defaults;
  return { ...(scenario.defaults || {}), ...shared, ...(scenario.turns?.[turn] || {}), turn };
}

export function statsForTurnDetailed(baseStats, items, turn, scenario = {}) {
  const stats = cloneStats(baseStats);
  const passives = [];
  for (const item of items) {
    const bonus = item.turnBonuses?.[turn];
    if (bonus) addStats(stats, bonus);
    passives.push(...(item.passives || []));
  }
  return applyPassiveModifiers(stats, passives, scenarioContextForTurn(scenario, turn));
}

export function statsForTurn(baseStats, items, turn, scenario = {}) {
  return statsForTurnDetailed(baseStats, items, turn, scenario).stats;
}

export function spellExpectedDamage(spell, stats, turn = 1) {
  const critChance = Math.max(0, Math.min(1, (Number(spell.baseCritPct || 0) + stat(stats, 'crit')) / 100));
  let nonCrit = 0;
  let crit = 0;

  for (const hit of spell.hits || []) {
    const element = hit.element || 'earth';
    const characteristic = stat(stats, ELEMENT_STAT[element]) + stat(stats, 'power');
    const flat = stat(stats, 'damage') + stat(stats, FLAT_DAMAGE_STAT[element]);
    const normalBase = midpoint(hit.normal);
    const critBase = midpoint(hit.crit ?? hit.normal);

    nonCrit += normalBase * (1 + characteristic / 100) + flat;
    crit += critBase * (1 + characteristic / 100) + flat + stat(stats, 'critDamage');
  }

  let expected = nonCrit * (1 - critChance) + crit * critChance;
  let specificPct = stat(stats, 'spellDamagePct');
  if (spell.distance === 'melee') specificPct += stat(stats, 'meleeDamagePct');
  if (spell.distance === 'ranged') specificPct += stat(stats, 'rangedDamagePct');
  expected *= 1 + specificPct / 100;

  // Final damage is a separate stage from spell/melee/ranged damage.
  const finalPct = stat(stats, 'finalDamagePct') + stat(stats, `finalDamagePctT${turn}`);
  expected *= 1 + finalPct / 100;
  return expected;
}

function selectedTurns(mode) {
  if (mode === 't1') return [1];
  if (mode === 't2') return [2];
  if (mode === 't3') return [3];
  return [1, 2, 3];
}

export function evaluateObjective({ stats, items = [], selections = [], turnMode = 'sum', scenario = {} }) {
  const turns = selectedTurns(turnMode);
  const perTurn = {};
  const unresolvedPassiveContexts = new Set();

  for (const turn of turns) {
    const turnResult = statsForTurnDetailed(stats, items, turn, scenario);
    const turnStats = turnResult.stats;
    for (const unresolved of turnResult.unresolved || []) {
      for (const key of unresolved.missingKeys || []) unresolvedPassiveContexts.add(key);
    }
    let score = 0;
    for (const selection of selections) {
      if (!selection.enabled) continue;
      const casts = Number(selection.casts?.[turn] ?? 1);
      const weight = Number(selection.weight ?? 1);
      score += spellExpectedDamage(selection.spell, turnStats, turn) * casts * weight;
    }
    perTurn[turn] = score;
  }

  const values = Object.values(perTurn);
  let score = values[0] || 0;
  if (turnMode === 'sum') score = values.reduce((a, b) => a + b, 0);
  if (turnMode === 'average') score = values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);
  if (turnMode === 'min') score = Math.min(...values);

  return { score, perTurn, unresolvedPassiveContexts: [...unresolvedPassiveContexts].sort() };
}

export function estimateElementValues(selections = [], referenceStats = {}) {
  const baseline = evaluateObjective({ stats: referenceStats, selections, turnMode: 'sum' }).score;
  const values = {};
  for (const element of ['earth', 'fire', 'water', 'air']) {
    const plusOne = { ...referenceStats, [element]: (referenceStats[element] || 0) + 1 };
    const score = evaluateObjective({ stats: plusOne, selections, turnMode: 'sum' }).score;
    values[element] = Math.max(0, score - baseline);
  }
  return values;
}
