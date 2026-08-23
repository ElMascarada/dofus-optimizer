import { addStats, cloneStats, constraintDeficits, stat } from './stats.js';
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
  delete shared.requiredApByTurn;
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

function spellRawTotals(spell, stats) {
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
  return { nonCrit, crit };
}

function damageSource(spell) {
  return spell?.damageSource === 'weapon' ? 'weapon' : 'spell';
}

function damageMultiplier(spell, stats, turn) {
  // Melee / ranged modes are intentionally ignored by the optimizer. The user
  // optimizes a spell package, not a battlefield positioning mode.
  const sourcePct = damageSource(spell) === 'weapon'
    ? stat(stats, 'weaponDamagePct')
    : stat(stats, 'spellDamagePct');
  const finalPct = stat(stats, 'finalDamagePct') + stat(stats, `finalDamagePctT${turn}`);
  return (1 + sourcePct / 100) * (1 + finalPct / 100);
}

export function spellExpectedDamage(spell, stats, turn = 1) {
  const critChance = Math.max(0, Math.min(1, (Number(spell.baseCritPct || 0) + stat(stats, 'crit')) / 100));
  const totals = spellRawTotals(spell, stats);
  const expected = totals.nonCrit * (1 - critChance) + totals.crit * critChance;
  return expected * damageMultiplier(spell, stats, turn);
}

// Safe upper bound used only by branch-and-bound. It deliberately allows each
// spell to choose whichever of its normal/critical outcomes is larger instead
// of assuming one shared achievable critical chance. That can overestimate a
// build, but it can never prune away a real optimum.
export function spellDamageUpperBound(spell, stats, turn = 1) {
  const totals = spellRawTotals(spell, stats);
  return Math.max(totals.nonCrit, totals.crit) * damageMultiplier(spell, stats, turn);
}

export function selectedTurnsForMode(mode) {
  if (mode === 't1') return [1];
  if (mode === 't2') return [2];
  if (mode === 't3') return [3];
  return [1, 2, 3];
}

export function requiredApForTurn(selections = [], turn = 1) {
  let total = 0;
  for (const selection of selections || []) {
    if (!selection?.enabled) continue;
    const casts = Math.max(0, Number(selection.casts?.[turn] ?? 0));
    const apCost = Math.max(0, Number(selection.spell?.apCost || 0));
    total += casts * apCost;
  }
  return total;
}

function aggregateTurnScores(perTurn, turnMode) {
  const values = Object.values(perTurn);
  let score = values[0] || 0;
  if (turnMode === 'sum') score = values.reduce((a, b) => a + b, 0);
  if (turnMode === 'average') score = values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);
  if (turnMode === 'min') score = Math.min(...values);
  return score;
}

export function evaluateTurnConstraints({ stats, items = [], constraints = {}, selections = [], turnMode = 'sum', scenario = {} }) {
  const perTurn = {};
  const deficitsByTurn = {};
  const requiredApByTurn = {};
  const unresolvedPassiveContexts = new Set();
  const explicitApByTurn = scenario?.requiredApByTurn || {};

  for (const turn of selectedTurnsForMode(turnMode)) {
    const turnResult = statsForTurnDetailed(stats, items, turn, scenario);
    perTurn[turn] = turnResult.stats;
    for (const unresolved of turnResult.unresolved || []) {
      for (const key of unresolved.missingKeys || []) unresolvedPassiveContexts.add(key);
    }
    const requiredAp = Math.max(
      requiredApForTurn(selections, turn),
      Math.max(0, Number(explicitApByTurn?.[turn] || 0))
    );
    requiredApByTurn[turn] = requiredAp;
    const turnConstraints = {
      ...constraints,
      ap: Math.max(Math.max(0, Number(constraints.ap || 0)), requiredAp)
    };
    const deficits = constraintDeficits(turnResult.stats, turnConstraints);
    if (Object.keys(deficits).length) deficitsByTurn[turn] = deficits;
  }

  return {
    meets: Object.keys(deficitsByTurn).length === 0 && unresolvedPassiveContexts.size === 0,
    perTurn,
    deficitsByTurn,
    requiredApByTurn,
    unresolvedPassiveContexts: [...unresolvedPassiveContexts].sort()
  };
}

export function evaluateObjective({ stats, items = [], selections = [], turnMode = 'sum', scenario = {} }) {
  const turns = selectedTurnsForMode(turnMode);
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

  return {
    score: aggregateTurnScores(perTurn, turnMode),
    perTurn,
    unresolvedPassiveContexts: [...unresolvedPassiveContexts].sort()
  };
}

export function evaluateObjectiveUpperBound({ stats, selections = [], turnMode = 'sum' }) {
  const perTurn = {};
  for (const turn of selectedTurnsForMode(turnMode)) {
    let score = 0;
    for (const selection of selections || []) {
      if (!selection?.enabled) continue;
      const casts = Math.max(0, Number(selection.casts?.[turn] ?? 1));
      const weight = Math.max(0, Number(selection.weight ?? 1));
      score += spellDamageUpperBound(selection.spell, stats, turn) * casts * weight;
    }
    perTurn[turn] = score;
  }
  return { score: aggregateTurnScores(perTurn, turnMode), perTurn };
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
