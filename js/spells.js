import { addStats, cloneStats, constraintDeficits, stat } from './stats.js';
import { applyPassiveModifiers } from './passives.js';
import { aggregateTemporalScore, turnsForTemporalMode } from './temporal-objectives.js';

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

function rangeEndpoint(range, index) {
  if (Array.isArray(range)) return Number(range[index] ?? range[0] ?? 0);
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

export function spellHitVariants(spell) {
  const hits = Array.isArray(spell?.hits) ? spell.hits : [];
  if (!hits.length) return [];

  if (spell?.damageSelection !== 'one-of-elements') {
    const elements = [...new Set(hits.map((hit) => hit?.element).filter(Boolean))];
    return [{ hits, element: elements.length === 1 ? elements[0] : null }];
  }

  const elemental = hits.filter((hit) => ['earth', 'fire', 'water', 'air'].includes(hit?.element));
  const distinct = new Set(elemental.map((hit) => hit.element));
  if (elemental.length === 4 && distinct.size === 4) {
    return elemental.map((hit) => ({ hits: [hit], element: hit.element }));
  }

  const elements = [...new Set(hits.map((hit) => hit?.element).filter(Boolean))];
  return [{ hits, element: elements.length === 1 ? elements[0] : null }];
}

function spellRawTotalsForHits(hits, stats) {
  let nonCrit = 0;
  let crit = 0;
  for (const hit of hits || []) {
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

function spellRawRangesForHits(hits, stats) {
  let normalMin = 0;
  let normalMax = 0;
  let critMin = 0;
  let critMax = 0;
  for (const hit of hits || []) {
    const element = hit.element || 'earth';
    const characteristic = stat(stats, ELEMENT_STAT[element]) + stat(stats, 'power');
    const flat = stat(stats, 'damage') + stat(stats, FLAT_DAMAGE_STAT[element]);
    const multiplier = 1 + characteristic / 100;
    const normal = hit.normal || [0, 0];
    const critical = hit.crit ?? normal;
    normalMin += rangeEndpoint(normal, 0) * multiplier + flat;
    normalMax += rangeEndpoint(normal, 1) * multiplier + flat;
    critMin += rangeEndpoint(critical, 0) * multiplier + flat + stat(stats, 'critDamage');
    critMax += rangeEndpoint(critical, 1) * multiplier + flat + stat(stats, 'critDamage');
  }
  return { normal: [normalMin, normalMax], critical: [critMin, critMax] };
}

function damageSource(spell) {
  return spell?.damageSource === 'weapon' ? 'weapon' : 'spell';
}

function positionDamage(spell, stats) {
  const options = Array.isArray(spell?.distanceOptions) ? spell.distanceOptions : [];
  const melee = options.includes('melee');
  const ranged = options.includes('ranged');

  if (melee && !ranged) return { pct: stat(stats, 'meleeDamagePct'), distance: 'melee' };
  if (ranged && !melee) return { pct: stat(stats, 'rangedDamagePct'), distance: 'ranged' };
  if (melee && ranged) {
    const meleePct = stat(stats, 'meleeDamagePct');
    const rangedPct = stat(stats, 'rangedDamagePct');
    return rangedPct > meleePct
      ? { pct: rangedPct, distance: 'ranged' }
      : { pct: meleePct, distance: 'melee' };
  }
  return { pct: 0, distance: null };
}

function damageMultiplierDetails(spell, stats, turn) {
  const sourcePct = damageSource(spell) === 'weapon'
    ? stat(stats, 'weaponDamagePct')
    : stat(stats, 'spellDamagePct');
  const position = positionDamage(spell, stats);
  const finalPct = stat(stats, 'finalDamagePct') + stat(stats, `finalDamagePctT${turn}`);

  const multiplier = (1 + sourcePct / 100)
    * (1 + position.pct / 100)
    * (1 + finalPct / 100);
  return { multiplier, distance: position.distance };
}

function breakdownForHits(spell, hits, stats, turn, element = null) {
  const critChance = Math.max(0, Math.min(1, (Number(spell.baseCritPct || 0) + stat(stats, 'crit')) / 100));
  const totals = spellRawTotalsForHits(hits, stats);
  const ranges = spellRawRangesForHits(hits, stats);
  const { multiplier, distance } = damageMultiplierDetails(spell, stats, turn);
  const expected = (totals.nonCrit * (1 - critChance) + totals.crit * critChance) * multiplier;
  return {
    expected,
    critChancePct: critChance * 100,
    normal: ranges.normal.map((value) => value * multiplier),
    critical: ranges.critical.map((value) => value * multiplier),
    element,
    distance,
    hits
  };
}

export function spellDamageVariants(spell, stats, turn = 1) {
  return spellHitVariants(spell).map((variant) => breakdownForHits(spell, variant.hits, stats, turn, variant.element));
}

export function spellDamageBreakdown(spell, stats, turn = 1) {
  const variants = spellDamageVariants(spell, stats, turn);
  if (!variants.length) {
    return { expected: 0, critChancePct: 0, normal: [0, 0], critical: [0, 0], element: null, distance: null, hits: [] };
  }
  return variants.reduce((best, current) => current.expected > best.expected ? current : best);
}

export function spellExpectedDamage(spell, stats, turn = 1) {
  return spellDamageBreakdown(spell, stats, turn).expected;
}

export function spellDamageUpperBound(spell, stats, turn = 1) {
  const { multiplier } = damageMultiplierDetails(spell, stats, turn);
  let best = 0;
  for (const variant of spellHitVariants(spell)) {
    const totals = spellRawTotalsForHits(variant.hits, stats);
    best = Math.max(best, Math.max(totals.nonCrit, totals.crit) * multiplier);
  }
  return best;
}

export function selectedTurnsForMode(mode) {
  return turnsForTemporalMode(mode);
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
  return aggregateTemporalScore(perTurn, turnMode);
}

function minimumBaseApMpMismatches(stats = {}, constraints = {}) {
  const mismatches = {};
  for (const key of ['ap', 'mp']) {
    const target = Number(constraints?.[key] || 0);
    if (!Number.isFinite(target) || target <= 0) continue;
    const actual = stat(stats, key);
    if (actual < target) mismatches[key] = { actual, target };
  }
  return mismatches;
}

export function evaluateTurnConstraints({ stats, items = [], constraints = {}, selections = [], turnMode = 'sum', scenario = {} }) {
  const perTurn = {};
  const deficitsByTurn = {};
  const requiredApByTurn = {};
  const unresolvedPassiveContexts = new Set();
  const hasExplicitApPlan = Object.prototype.hasOwnProperty.call(scenario || {}, 'requiredApByTurn');
  const explicitApByTurn = scenario?.requiredApByTurn || {};
  const baseApMpMismatches = minimumBaseApMpMismatches(stats, constraints);

  for (const turn of selectedTurnsForMode(turnMode)) {
    const turnResult = statsForTurnDetailed(stats, items, turn, scenario);
    perTurn[turn] = turnResult.stats;
    for (const unresolved of turnResult.unresolved || []) {
      for (const key of unresolved.missingKeys || []) unresolvedPassiveContexts.add(key);
    }

    const requiredAp = hasExplicitApPlan
      ? Math.max(0, Number(explicitApByTurn?.[turn] || 0))
      : requiredApForTurn(selections, turn);
    requiredApByTurn[turn] = requiredAp;

    const turnConstraints = {
      ...constraints,
      ap: Math.max(Math.max(0, Number(constraints.ap || 0)), requiredAp)
    };
    const deficits = constraintDeficits(turnResult.stats, turnConstraints);
    if (Object.keys(deficits).length) deficitsByTurn[turn] = deficits;
  }

  return {
    meets: Object.keys(baseApMpMismatches).length === 0
      && Object.keys(deficitsByTurn).length === 0,
    perTurn,
    deficitsByTurn,
    baseApMpMismatches,
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
