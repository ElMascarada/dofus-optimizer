import {
  compareCompleteEquipmentBuildResults,
  evaluateCompleteEquipmentBuild
} from '../js/complete-equipment-build-evaluator.js';
import { addStats, effectiveStat, emptyStats } from '../js/stats.js';
import { specialSlotRulesAreValid } from '../js/build-legality.js';
import { buildEquipmentCandidatePools } from './equipment-candidate-policy.js';
import { filterOptimizerEligibleItems } from './item-eligibility.js';

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
    bases.push({ baseItems, source: result });
    if (bases.length >= Math.max(1, Number(baseContextLimit || BASE_CONTEXT_LIMIT))) break;
  }

  const refined = [];
  let evaluated = 0;
  let valid = 0;
  for (const base of bases) {
    for (const pack of frontier.packages) {
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
      evaluated,
      valid,
      improved,
      bestDofus: (refinedBest?.items || [])
        .filter((item) => item?.slot === 'dofus')
        .map((item) => item?.name || item?.id)
    }
  };
}
