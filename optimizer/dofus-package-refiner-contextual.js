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

function conditionIsMonotoneUnderStatIncrease(node) {
  if (!node) return true;
  if (node.kind === 'relation') {
    return (node.children || []).every((child) => conditionIsMonotoneUnderStatIncrease(child));
  }
  if (STATIC_CONDITION_STATS.has(String(node.stat || ''))) return true;
  return node.operator === 'gte' || node.operator === 'gt';
}

function staticPackageConditionsAreValid(pack = {}, baseItems = [], baseStats = {}) {
  const conditionStats = {
    ...baseStats,
    ap: effectiveStat(baseStats, 'ap') + Number(pack?.ap || 0),
    mp: effectiveStat(baseStats, 'mp') + Number(pack?.mp || 0),
    level: Number(BASE_CHARACTER?.level || 200),
    setBonus: countSetBonuses([...baseItems, ...(pack?.items || [])])
  };

  for (const item of pack?.items || []) {
    if (!item?.conditions || !conditionUsesOnlyStaticContext(item.conditions)) continue;
    if (!evaluateNormalizedCondition(item.conditions, conditionStats)) return false;
  }
  return true;
}

function remainingConditionSignature(pack = {}) {
  return JSON.stringify((pack?.items || [])
    .map((item) => item?.conditions || null)
    .filter((condition) => condition && !conditionUsesOnlyStaticContext(condition))
    .map((condition) => JSON.stringify(condition))
    .sort());
}

function setSignature(pack = {}) {
  return JSON.stringify((pack?.items || [])
    .map((item) => item?.setId || null)
    .filter(Boolean)
    .sort());
}

function collectConditionStats(node, output) {
  if (!node) return;
  if (node.kind === 'relation') {
    for (const child of node.children || []) collectConditionStats(child, output);
    return;
  }
  if (node.stat) output.add(String(node.stat));
}

function contextDominanceKeys(packages = [], constraints = {}, baseItems = []) {
  const keys = new Set();
  for (const pack of packages) {
    for (const [key, value] of Object.entries(pack?.stats || {})) {
      if (Number.isFinite(Number(value))) keys.add(key);
    }
    for (const item of pack?.items || []) collectConditionStats(item?.conditions, keys);
  }
  for (const [key, value] of Object.entries(constraints || {})) {
    if (Number.isFinite(Number(value))) keys.add(key);
  }
  for (const item of baseItems || []) collectConditionStats(item?.conditions, keys);
  keys.delete('ap');
  keys.delete('mp');
  keys.delete('setBonus');
  keys.delete('level');
  return [...keys].sort();
}

function dominatesPackage(left, right, keys) {
  let strictlyBetter = false;
  for (const key of keys) {
    const lv = effectiveStat(left?.stats || {}, key);
    const rv = effectiveStat(right?.stats || {}, key);
    if (lv < rv) return false;
    if (lv > rv) strictlyBetter = true;
  }
  return strictlyBetter;
}

function samePackageVector(left, right, keys) {
  return keys.every((key) => effectiveStat(left?.stats || {}, key) === effectiveStat(right?.stats || {}, key));
}

function prunePackagesForResolvedContext(packages = [], baseItems = []) {
  if (!(baseItems || []).every((item) => conditionIsMonotoneUnderStatIncrease(item?.conditions))) {
    return { packages: [...packages], pruned: 0, applied: false, reason: 'unsafe-base-condition' };
  }

  const keys = contextDominanceKeys(packages, {}, baseItems);
  const buckets = new Map();
  let pruned = 0;

  for (const candidate of packages) {
    const bucketKey = `${candidate?.ap || 0}:${candidate?.mp || 0}:${remainingConditionSignature(candidate)}:${setSignature(candidate)}`;
    if (!buckets.has(bucketKey)) buckets.set(bucketKey, []);
    const frontier = buckets.get(bucketKey);

    let dominated = false;
    for (const existing of frontier) {
      if (dominatesPackage(existing, candidate, keys) || samePackageVector(existing, candidate, keys)) {
        dominated = true;
        break;
      }
    }
    if (dominated) {
      pruned++;
      continue;
    }

    for (let index = frontier.length - 1; index >= 0; index--) {
      if (dominatesPackage(candidate, frontier[index], keys)) {
        frontier.splice(index, 1);
        pruned++;
      }
    }
    frontier.push(candidate);
  }

  return {
    packages: [...buckets.values()].flat(),
    pruned,
    applied: true,
    reason: null
  };
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
  let contextFrontierPackages = 0;
  let prunedByContextDominance = 0;
  let contextsPruned = 0;
  let evaluated = 0;
  let valid = 0;

  for (const base of bases) {
    const compatible = [];
    for (const pack of frontier.packages) {
      packageChecks++;
      if (!packageCanClosePermanentResources(pack, base.structuralStats, constraints)) continue;
      resourceCompatiblePackages++;
      if (!staticPackageConditionsAreValid(pack, base.baseItems, base.structuralStats)) continue;
      staticConditionCompatiblePackages++;
      compatible.push(pack);
    }

    const contextual = prunePackagesForResolvedContext(compatible, base.baseItems);
    contextFrontierPackages += contextual.packages.length;
    prunedByContextDominance += contextual.pruned;
    if (contextual.applied) contextsPruned++;

    for (const pack of contextual.packages) {
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
      contextFrontierPackages,
      prunedByResource: packageChecks - resourceCompatiblePackages,
      prunedByStaticCondition: resourceCompatiblePackages - staticConditionCompatiblePackages,
      prunedByContextDominance,
      contextsPruned,
      evaluated,
      valid,
      improved,
      bestDofus: (refinedBest?.items || [])
        .filter((item) => item?.slot === 'dofus')
        .map((item) => item?.name || item?.id)
    }
  };
}
