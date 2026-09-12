import { BASE_CHARACTER } from '../js/config.js';
import {
  compareCompleteEquipmentBuildResults,
  evaluateCompleteEquipmentBuild
} from '../js/complete-equipment-build-evaluator.js';
import {
  countSetBonuses,
  evaluateNormalizedCondition,
  MAX_PERMANENT_AP,
  MAX_PERMANENT_MP
} from '../js/build-legality.js';
import { applySetBonuses } from '../js/sets.js';
import { statsWithStructuralExos } from '../js/structural-exos.js';
import { addStats, effectiveStat, emptyStats } from '../js/stats.js';
import { buildEquipmentCandidatePools } from './equipment-candidate-policy.js';
import { filterOptimizerEligibleItems } from './item-eligibility.js';
import { buildDofusPackageFrontier } from './dofus-package-frontier.js';

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
const STATIC_CONDITION_STATS = new Set(['setBonus', 'level', 'ap', 'mp']);
const DOFUS_POOL_LIMIT = 20;
const BASE_CONTEXT_LIMIT = 30;

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

function dofusAllowed(item, critMode) {
  const name = String(item?.name || '');
  if (critMode === 'crit' && /^Robuste(?: majeur)?$/i.test(name)) return false;
  if (critMode === 'no_crit' && /^Dofus Turquoise$/i.test(name)) return false;
  return true;
}

function selectDofusPool({
  items = [],
  sets = [],
  constraints = {},
  fmPolicy = {},
  syntheticOffense = {},
  searchProfile = 'BALANCED'
} = {}) {
  const critMode = String(syntheticOffense?.critMode || 'auto').toLowerCase();
  const eligible = filterOptimizerEligibleItems(items)
    .filter((item) => item?.slot === 'dofus' && dofusAllowed(item, critMode));

  const prefilter = buildEquipmentCandidatePools({
    items,
    sets,
    constraints,
    fmPolicy,
    syntheticOffense,
    searchProfile
  });
  const policy = prefilter.policy;
  const byName = new Map(eligible.map((item) => [String(item?.name || ''), item]));
  const selected = new Map();

  function add(item) {
    if (!item || selected.size >= DOFUS_POOL_LIMIT || !dofusAllowed(item, critMode)) return;
    selected.set(String(item.id), item);
  }

  for (const name of [
    'Dofus Ocre',
    'Dofus Vulbis',
    'Vulbis',
    'Dofus Pourpre',
    'Dofus des Glaces',
    'Dofus Turquoise',
    'Dolmanax',
    'Robuste majeur',
    'Turbulent'
  ]) add(byName.get(name));

  const rows = eligible.map((item) => ({ item, profiled: policy.profileItem(item) }));
  const axes = requestedAxes(syntheticOffense);
  const specialists = [...new Set([
    ...COMMON_KEYS,
    ...axes,
    ...axes.map((element) => ELEMENT_DAMAGE[element]),
    'ap',
    'mp'
  ])];

  for (const key of specialists) {
    for (const row of [...rows]
      .filter((entry) => effectiveStat(entry.item?.stats || {}, key) > 0)
      .sort((a, b) => effectiveStat(b.item?.stats || {}, key) - effectiveStat(a.item?.stats || {}, key)
        || Number(b.profiled.objectiveGain || 0) - Number(a.profiled.objectiveGain || 0))
      .slice(0, 2)) add(row.item);
  }

  for (const item of prefilter.pools?.dofus || []) add(item);

  for (const row of rows.sort((a, b) => Number(b.profiled.objectiveGain || 0) - Number(a.profiled.objectiveGain || 0)
    || Number(b.profiled.meanGain || 0) - Number(a.profiled.meanGain || 0)
    || String(a.item.id).localeCompare(String(b.item.id)))) add(row.item);

  return [...selected.values()];
}

function insertResult(results, candidate, topN) {
  if (!candidate) return;
  const existing = results.findIndex((entry) => entry.buildIdentity === candidate.buildIdentity);
  if (existing >= 0) results.splice(existing, 1);
  results.push(candidate);
  results.sort((a, b) => -compareCompleteEquipmentBuildResults(a, b));
  if (results.length > topN) results.length = topN;
}

function setsByIdFor(sets = []) {
  return Object.fromEntries((sets || []).map((set) => [set.id, set]));
}

function structuralBaseStats(baseItems = [], sets = [], fmPolicy = {}) {
  const raw = emptyStats();
  addStats(raw, BASE_CHARACTER?.baseStats || {});
  for (const item of baseItems || []) addStats(raw, item?.stats || {});
  const withSets = { ...raw };
  applySetBonuses(withSets, baseItems, setsByIdFor(sets));
  return statsWithStructuralExos(withSets, fmPolicy).stats;
}

export function packageCanClosePermanentResources(pack = {}, baseStats = {}, constraints = {}) {
  const ap = effectiveStat(baseStats, 'ap') + Number(pack?.ap || 0);
  const mp = effectiveStat(baseStats, 'mp') + Number(pack?.mp || 0);
  const minimumAp = Math.max(0, Number(constraints?.ap || 0));
  const minimumMp = Math.max(0, Number(constraints?.mp || 0));
  return ap <= MAX_PERMANENT_AP
    && mp <= MAX_PERMANENT_MP
    && ap >= minimumAp
    && mp >= minimumMp;
}

function conditionUsesOnlyStaticContext(node) {
  if (!node) return true;
  if (node.kind === 'relation') {
    return (node.children || []).every((child) => conditionUsesOnlyStaticContext(child));
  }
  return STATIC_CONDITION_STATS.has(String(node.stat || ''));
}

function staticPackageConditionsAreValid(pack = {}, baseItems = [], baseStats = {}) {
  const conditionStats = {
    ...baseStats,
    ap: effectiveStat(baseStats, 'ap') + Number(pack?.ap || 0),
    mp: effectiveStat(baseStats, 'mp') + Number(pack?.mp || 0),
    level: Number(BASE_CHARACTER?.level || 200),
    setBonus: countSetBonuses(baseItems)
  };

  for (const item of pack?.items || []) {
    if (!item?.conditions || !conditionUsesOnlyStaticContext(item.conditions)) continue;
    if (!evaluateNormalizedCondition(item.conditions, conditionStats)) return false;
  }
  return true;
}

export function refineDofusPackagesForResults({
  results = [],
  items = [],
  sets = [],
  constraints = {},
  fmPolicy = {},
  syntheticOffense = {},
  searchProfile = 'BALANCED',
  topN = 100,
  baseContextLimit = BASE_CONTEXT_LIMIT
} = {}) {
  if (!(results || []).length) {
    return {
      results: [],
      diagnostics: {
        applied: false,
        reason: 'no-input-results'
      }
    };
  }

  const pool = selectDofusPool({
    items,
    sets,
    constraints,
    fmPolicy,
    syntheticOffense,
    searchProfile
  });
  const frontier = buildDofusPackageFrontier(pool, {
    syntheticOffense,
    constraints
  });

  const bases = [];
  const seenBases = new Set();
  for (const result of results || []) {
    const baseItems = (result?.items || []).filter((item) => item?.slot !== 'dofus');
    const key = itemKey(baseItems);
    if (!key || seenBases.has(key)) continue;
    seenBases.add(key);
    bases.push({
      baseItems,
      source: result,
      structuralStats: structuralBaseStats(baseItems, sets, fmPolicy)
    });
    if (bases.length >= Math.max(1, Number(baseContextLimit || BASE_CONTEXT_LIMIT))) break;
  }

  const refined = [];
  let packageChecks = 0;
  let resourceCompatiblePackages = 0;
  let staticConditionCompatiblePackages = 0;
  let evaluated = 0;
  let valid = 0;

  for (const base of bases) {
    for (const pack of frontier.packages) {
      packageChecks++;
      if (!packageCanClosePermanentResources(pack, base.structuralStats, constraints)) continue;
      resourceCompatiblePackages++;
      if (!staticPackageConditionsAreValid(pack, base.baseItems, base.structuralStats)) continue;
      staticConditionCompatiblePackages++;

      const evaluation = evaluateCompleteEquipmentBuild({
        items: [...base.baseItems, ...pack.items],
        sets,
        constraints,
        fmPolicy,
        syntheticOffense
      });
      evaluated++;
      if (!evaluation.result) continue;
      valid++;
      insertResult(refined, {
        ...evaluation.result,
        searchArchitecture: {
          ...(base.source?.searchArchitecture || {}),
          exactDofusRefine: true
        }
      }, Math.max(1, Number(topN || 100)));
    }
  }

  const output = refined.length ? refined : [...results];
  const originalBest = results?.[0] || null;
  const refinedBest = output?.[0] || null;
  const improved = originalBest && refinedBest
    ? compareCompleteEquipmentBuildResults(refinedBest, originalBest) > 0
    : false;

  return {
    results: output,
    diagnostics: {
      applied: true,
      poolSize: pool.length,
      poolNames: pool.map((item) => item?.name || item?.id),
      hasOcre: pool.some((item) => String(item?.name || '') === 'Dofus Ocre'),
      hasVulbis: pool.some((item) => /Vulbis/i.test(String(item?.name || ''))),
      combinations: frontier.combinations,
      legalCombinations: frontier.legalCombinations,
      frontierPackages: frontier.packages.length,
      baseContexts: bases.length,
      packageChecks,
      resourceCompatiblePackages,
      staticConditionCompatiblePackages,
      prunedByResource: packageChecks - resourceCompatiblePackages,
      prunedByStaticCondition: resourceCompatiblePackages - staticConditionCompatiblePackages,
      evaluated,
      valid,
      improved,
      bestDofus: (refinedBest?.items || [])
        .filter((item) => item?.slot === 'dofus')
        .map((item) => item?.name || item?.id)
    }
  };
}
