import { BASE_CHARACTER, SLOT_RULES } from '../js/config.js';
import { addStats, effectiveStat, emptyStats } from '../js/stats.js';
import { applySetBonuses } from '../js/sets.js';
import { specialSlotRulesAreValid } from '../js/build-legality.js';
import { statsWithStructuralExos } from '../js/structural-exos.js';
import {
  compareCompleteEquipmentBuildResults,
  evaluateCompleteEquipmentBuild
} from '../js/complete-equipment-build-evaluator.js';
import {
  buildEquipmentCandidatePools,
  positiveEquipmentConstraintKeys
} from './equipment-candidate-policy.js';
import { filterOptimizerEligibleItems } from './item-eligibility.js';
import { buildSetCoreCatalog } from './set-core-catalog.js';

const ELEMENT_PROFILE = Object.freeze({
  earth: 'terre',
  fire: 'feu',
  water: 'eau',
  air: 'air'
});

const PRIMARY_ARCHITECTURE_LIMIT = 60;
const PER_PATTERN_LIMIT = 35;
const EQUIPMENT_STATE_LIMIT = 24;
const COMPANION_POOL_LIMIT = 14;
const PRIMARY_CLOSURE_RESERVE = 32;
const FINAL_CONTEXT_LIMIT = 40;
const MAX_STRUCTURAL_DOFUS_SLOTS = 2;

function itemKey(items = []) {
  return (items || []).map((item) => String(item?.id ?? '')).sort().join('|');
}

function setsByIdFor(sets = []) {
  return Object.fromEntries((sets || []).map((set) => [set.id, set]));
}

function staticBuildStats(items = [], setsById = {}) {
  const stats = emptyStats();
  addStats(stats, BASE_CHARACTER.baseStats || {});
  for (const item of items || []) addStats(stats, item?.stats || {});
  applySetBonuses(stats, items, setsById);
  return stats;
}

function contextualBuildStats(items = [], setsById = {}, fmPolicy = {}) {
  return statsWithStructuralExos(staticBuildStats(items, setsById), fmPolicy).stats;
}

function choose(values, count) {
  const output = [];
  const chosen = [];
  function visit(start) {
    if (chosen.length === count) {
      output.push([...chosen]);
      return;
    }
    const remaining = count - chosen.length;
    for (let index = start; index <= values.length - remaining; index++) {
      chosen.push(values[index]);
      visit(index + 1);
      chosen.pop();
    }
  }
  visit(0);
  return output;
}

export function dofusBranchAllows(item, branch) {
  const name = String(item?.name || '');
  if (branch === 'CRIT' && /^Robuste(?: majeur)?$/i.test(name)) return false;
  if (branch === 'NO_CRIT' && name === 'Dofus Turquoise') return false;
  return true;
}

export function preserveClosureAwareStates(
  rawStates = [],
  legacyStates = [],
  {
    limit = FINAL_CONTEXT_LIMIT,
    reserve = PRIMARY_CLOSURE_RESERVE,
    isClosable = () => false,
    bucketOf = () => 'default'
  } = {}
) {
  const dedup = new Map();
  for (const state of rawStates || []) {
    const key = itemKey(state?.items || []);
    if (!key) continue;
    const previous = dedup.get(key);
    if (!previous || Number(state?.score || 0) > Number(previous?.score || 0)) dedup.set(key, state);
  }

  const closable = [...dedup.values()]
    .filter(isClosable)
    .sort((a, b) => Number(b?.score || 0) - Number(a?.score || 0)
      || itemKey(a.items).localeCompare(itemKey(b.items)));

  const reserved = [];
  const perBucket = new Map();
  for (const state of closable) {
    if (reserved.length >= reserve) break;
    const bucket = String(bucketOf(state));
    const used = Number(perBucket.get(bucket) || 0);
    if (used >= 4) continue;
    perBucket.set(bucket, used + 1);
    reserved.push(state);
  }
  for (const state of closable) {
    if (reserved.length >= reserve) break;
    if (!reserved.some((entry) => itemKey(entry.items) === itemKey(state.items))) reserved.push(state);
  }

  const output = [];
  const seen = new Set();
  function add(state) {
    if (!state || output.length >= limit) return;
    const key = itemKey(state.items || []);
    if (!key || seen.has(key)) return;
    seen.add(key);
    output.push(state);
  }

  for (const state of reserved) add(state);
  for (const state of legacyStates || []) add(state);
  for (const state of [...dedup.values()].sort((a, b) =>
    Number(b?.score || 0) - Number(a?.score || 0)
    || itemKey(a.items).localeCompare(itemKey(b.items))
  )) add(state);

  return output;
}

function requestedSingleElement(syntheticOffense = {}) {
  const raw = [...new Set((syntheticOffense?.elements || [])
    .map((value) => String(value).toLowerCase())
    .filter(Boolean))];
  if (raw.length !== 1) return null;
  return ELEMENT_PROFILE[raw[0]] ? raw[0] : null;
}

function keepByResourceBucket(states, limit, perBucket, { setsById, constraints, fmPolicy = {} }) {
  const dedup = new Map();
  for (const state of states || []) {
    const key = itemKey(state.items);
    const previous = dedup.get(key);
    if (!previous || Number(state.score || 0) > Number(previous.score || 0)) dedup.set(key, state);
  }
  const ranked = [...dedup.values()].sort((a, b) =>
    Number(b.score || 0) - Number(a.score || 0)
    || itemKey(a.items).localeCompare(itemKey(b.items))
  );

  const output = [];
  const used = new Map();
  function bucket(state) {
    const stats = contextualBuildStats(state.items, setsById, fmPolicy);
    const apTarget = Math.max(1, Number(constraints?.ap || 12));
    const mpTarget = Math.max(1, Number(constraints?.mp || 6));
    const ap = Math.min(apTarget, effectiveStat(stats, 'ap'));
    const mp = Math.min(mpTarget, effectiveStat(stats, 'mp'));
    return `${ap}:${mp}`;
  }

  for (const state of ranked) {
    if (output.length >= limit) break;
    const key = bucket(state);
    const count = Number(used.get(key) || 0);
    if (count >= perBucket) continue;
    used.set(key, count + 1);
    output.push(state);
  }
  for (const state of ranked) {
    if (output.length >= limit) break;
    if (!output.some((entry) => itemKey(entry.items) === itemKey(state.items))) output.push(state);
  }
  return output;
}

function distinctRows(rows = []) {
  const map = new Map();
  for (const row of rows.filter(Boolean)) map.set(String(row.item.id), row);
  return [...map.values()];
}

function doctrineFor({ dofusItems, policy, elementKey }) {
  const rows = (dofusItems || []).map((item) => {
    const profiled = policy.profileItem(item);
    const ranked = policy.rankStats(profiled?.optimisticStats || item.stats || {});
    const stats = item.stats || {};
    return {
      item,
      objective: Number(ranked.objectiveGain || 0),
      element: Number(effectiveStat(stats, elementKey) || 0),
      vit: Number(effectiveStat(stats, 'vit') || 0),
      meleePct: Number(effectiveStat(stats, 'meleeDamagePct') || 0),
      rangedPct: Number(effectiveStat(stats, 'rangedDamagePct') || 0),
      spellPct: Number(effectiveStat(stats, 'spellDamagePct') || 0),
      weaponPct: Number(effectiveStat(stats, 'weaponDamagePct') || 0)
    };
  });

  const byName = new Map(rows.map((row) => [String(row.item.name), row]));
  const exact = (name) => byName.get(name) || null;
  const firstNamed = (...names) => names.map(exact).find(Boolean) || null;

  const pourpre = firstNamed('Dofus Pourpre');
  const ddg = firstNamed('Dofus des Glaces');
  const turquoise = firstNamed('Dofus Turquoise');
  const ocre = firstNamed('Dofus Ocre');
  const vulbis = firstNamed('Dofus Vulbis', 'Vulbis');
  const dolmanax = firstNamed('Dolmanax');
  const robuste = firstNamed('Robuste majeur');

  const mono = [...rows]
    .filter((row) => row.element >= 80 && row.vit <= -100)
    .sort((a, b) => b.element - a.element
      || b.objective - a.objective
      || String(a.item.id).localeCompare(String(b.item.id)))[0] || null;

  const damageSpecialists = rows
    .map((row) => ({
      ...row,
      pctDamage: Math.max(row.meleePct, row.rangedPct, row.spellPct, row.weaponPct)
    }))
    .filter((row) => row.pctDamage > 0)
    .sort((a, b) => b.pctDamage - a.pctDamage
      || b.objective - a.objective
      || String(a.item.id).localeCompare(String(b.item.id)))
    .slice(0, 6);

  return {
    rows,
    pourpre,
    ddg,
    turquoise,
    ocre,
    vulbis,
    dolmanax,
    robuste,
    mono,
    damageSpecialists
  };
}

function resultInsert(results, candidate, topN) {
  if (!candidate) return;
  const existing = results.findIndex((entry) => entry.buildIdentity === candidate.buildIdentity);
  if (existing >= 0) results.splice(existing, 1);
  results.push(candidate);
  results.sort((a, b) => -compareCompleteEquipmentBuildResults(a, b));
  if (results.length > topN) results.length = topN;
}

export function searchSetCoreFirstEquipment({
  items = [],
  sets = [],
  constraints = {},
  fmPolicy = {},
  syntheticOffense = {},
  topN = 10,
  searchProfile = 'BALANCED',
  onProgress = null,
  onDiagnostics = null
} = {}) {
  const elementKey = requestedSingleElement(syntheticOffense);
  if (!elementKey) return { applicable: false, results: [] };

  const profileId = ELEMENT_PROFILE[elementKey];
  const eligibleItems = filterOptimizerEligibleItems(items);
  const setsById = setsByIdFor(sets);

  const prefilter = buildEquipmentCandidatePools({
    items: eligibleItems,
    sets,
    constraints,
    fmPolicy,
    syntheticOffense,
    searchProfile
  });
  const policy = prefilter.policy;

  const doctrine = doctrineFor({
    dofusItems: prefilter.pools?.dofus || [],
    policy,
    elementKey
  });

  if (!doctrine.pourpre || !doctrine.ddg || !doctrine.ocre || !doctrine.vulbis || !doctrine.mono) {
    return {
      applicable: false,
      results: [],
      diagnostics: { mode: 'set-core-first-search-v1', reason: 'canonical-dofus-family-unavailable' }
    };
  }

  const objectiveForStats = (stats) => Number(policy.rankStats(stats).objectiveGain || 0);
  const objectiveForItems = (selected) => objectiveForStats(staticBuildStats(selected, setsById));

  const catalog = buildSetCoreCatalog({
    items: eligibleItems,
    sets,
    pieceCounts: [2, 3],
    minLevel: 190,
    maxLevel: 200,
    profileItem: (item) => policy.profileItem(item)
  });

  const relevantCores = (catalog.cores || [])
    .filter((core) => core?.legality?.valid)
    .filter((core) => Number(core?.profile?.strengths?.[profileId]?.level || 0) > 0)
    .map((core) => ({
      ...core,
      offenseScore: objectiveForStats(core.searchStats || core.aggregateStats || {}),
      apBonus: Number(core?.setBonuses?.ap || 0),
      mpBonus: Number(core?.setBonuses?.mp || 0)
    }));

  if (!relevantCores.length) {
    return {
      applicable: false,
      results: [],
      diagnostics: { mode: 'set-core-first-search-v1', reason: 'no-relevant-set-core' }
    };
  }

  const slotSignature = (core) => Object.entries(core.occupiedSlots || {})
    .sort(([a], [b]) => String(a).localeCompare(String(b)))
    .map(([slot, count]) => `${slot}:${count}`)
    .join(',');

  const representativeMap = new Map();
  for (const core of relevantCores) {
    const key = `${core.setId}:${core.pieceCount}:${slotSignature(core)}`;
    const list = representativeMap.get(key) || [];
    list.push(core);
    representativeMap.set(key, list);
  }

  const representatives = [];
  for (const list of representativeMap.values()) {
    list.sort((a, b) => b.offenseScore - a.offenseScore
      || String(a.id).localeCompare(String(b.id)));
    representatives.push(...list.slice(0, 2));
  }

  function boundedCorePool(pieceCount) {
    const pool = representatives.filter((core) => core.pieceCount === pieceCount);
    const selected = new Map();
    const add = (values, count) => {
      for (const core of values.slice(0, count)) selected.set(core.id, core);
    };
    add([...pool].sort((a, b) => b.offenseScore - a.offenseScore), 90);
    add([...pool].sort((a, b) => b.apBonus - a.apBonus || b.offenseScore - a.offenseScore), 30);
    add([...pool].sort((a, b) => b.mpBonus - a.mpBonus || b.offenseScore - a.offenseScore), 30);
    return [...selected.values()]
      .sort((a, b) => b.offenseScore - a.offenseScore)
      .slice(0, 120);
  }

  const core2 = boundedCorePool(2);
  const core3 = boundedCorePool(3);

  const equipmentCaps = new Map(
    SLOT_RULES
      .filter((rule) => !['dofus', 'companion'].includes(rule.id))
      .map((rule) => [rule.id, Number(rule.count || 0)])
  );

  function compatibleCores(cores) {
    const seenSets = new Set();
    const seenItems = new Set();
    const slots = new Map();
    const selectedItems = [];

    for (const core of cores) {
      const setId = String(core.setId);
      if (seenSets.has(setId)) return false;
      seenSets.add(setId);
      for (const item of core.items) {
        const id = String(item.id);
        if (seenItems.has(id)) return false;
        seenItems.add(id);
        const count = Number(slots.get(item.slot) || 0) + 1;
        if (count > Number(equipmentCaps.get(item.slot) || 0)) return false;
        slots.set(item.slot, count);
        selectedItems.push(item);
      }
    }
    return specialSlotRulesAreValid(selectedItems);
  }

  const patterns = [
    { name: '3+3+3', counts: [3, 3, 3] },
    { name: '3+3+2+1', counts: [3, 3, 2] },
    { name: '3+2+2+2', counts: [3, 2, 2, 2] },
    { name: '3+2+2+1+1', counts: [3, 2, 2] },
    { name: '3+3+1+1+1', counts: [3, 3] },
    { name: '3+2+1+1+1+1', counts: [3, 2] }
  ];

  let architectureGenerated = 0;
  const architectureCandidates = [];

  function enumeratePattern(pattern) {
    const local = [];
    const pools = pattern.counts.map((count) => count === 3 ? core3 : core2);

    function visit(depth, chosen, indexes) {
      if (depth === pools.length) {
        if (!compatibleCores(chosen)) return;
        const selected = chosen.flatMap((core) => core.items);
        local.push({
          pattern: pattern.name,
          cores: [...chosen],
          items: selected,
          score: objectiveForItems(selected)
        });
        return;
      }
      const pool = pools[depth];
      const sameAsPrevious = depth > 0 && pattern.counts[depth] === pattern.counts[depth - 1];
      const start = sameAsPrevious ? Number(indexes[depth - 1] || 0) + 1 : 0;
      for (let index = start; index < pool.length; index++) {
        const next = [...chosen, pool[index]];
        if (!compatibleCores(next)) continue;
        visit(depth + 1, next, [...indexes, index]);
      }
    }

    visit(0, [], []);
    architectureGenerated += local.length;
    return keepByResourceBucket(local, PER_PATTERN_LIMIT, 4, { setsById, constraints, fmPolicy });
  }

  for (const pattern of patterns) architectureCandidates.push(...enumeratePattern(pattern));

  const architectureStates = keepByResourceBucket(
    architectureCandidates,
    PRIMARY_ARCHITECTURE_LIMIT,
    6,
    { setsById, constraints, fmPolicy }
  );

  function poolForSlot(slot) {
    const base = prefilter.pools?.[slot] || [];
    const profiled = base.map((item) => {
      const profile = policy.profileItem(item);
      const ranked = policy.rankStats(profile?.optimisticStats || item.stats || {});
      return {
        item,
        objective: Number(ranked.objectiveGain || 0),
        ap: Number(effectiveStat(item.stats || {}, 'ap') || 0),
        mp: Number(effectiveStat(item.stats || {}, 'mp') || 0)
      };
    });

    const selected = new Map();
    const add = (values, count) => {
      for (const row of values.slice(0, count)) selected.set(String(row.item.id), row.item);
    };
    add([...profiled].sort((a, b) => b.objective - a.objective), 9);
    add([...profiled].sort((a, b) => b.ap - a.ap || b.objective - a.objective), 4);
    add([...profiled].sort((a, b) => b.mp - a.mp || b.objective - a.objective), 4);
    return [...selected.values()];
  }

  const slotPools = Object.fromEntries(
    [...equipmentCaps.keys()].map((slot) => [slot, poolForSlot(slot)])
  );

  function missingSlots(selected) {
    const counts = new Map();
    for (const item of selected) counts.set(item.slot, Number(counts.get(item.slot) || 0) + 1);
    const missing = [];
    for (const [slot, count] of equipmentCaps) {
      const have = Number(counts.get(slot) || 0);
      for (let index = have; index < count; index++) missing.push(slot);
    }
    return missing;
  }

  const completeEquipment = [];
  for (const architecture of architectureStates) {
    let states = [{
      items: architecture.items,
      pattern: architecture.pattern,
      score: architecture.score
    }];

    for (const slot of missingSlots(architecture.items)) {
      const expanded = [];
      for (const state of states) {
        const used = new Set(state.items.map((item) => String(item.id)));
        for (const item of slotPools[slot] || []) {
          if (used.has(String(item.id))) continue;
          const nextItems = [...state.items, item];
          if (!specialSlotRulesAreValid(nextItems)) continue;
          expanded.push({
            items: nextItems,
            pattern: state.pattern,
            score: objectiveForItems(nextItems)
          });
        }
      }
      states = keepByResourceBucket(expanded, 35, 4, { setsById, constraints, fmPolicy });
      if (!states.length) break;
    }

    for (const state of states) if (state.items.length === 9) completeEquipment.push(state);
  }

  const equipmentStates = keepByResourceBucket(
    completeEquipment,
    EQUIPMENT_STATE_LIMIT,
    4,
    { setsById, constraints, fmPolicy }
  );

  const companionPool = poolForSlot('companion').slice(0, COMPANION_POOL_LIMIT);
  const companionRaw = [];
  for (const state of equipmentStates) {
    for (const companion of companionPool) {
      const selected = [...state.items, companion];
      if (!specialSlotRulesAreValid(selected)) continue;
      companionRaw.push({
        items: selected,
        pattern: state.pattern,
        score: objectiveForItems(selected)
      });
    }
  }

  const legacyCompanionSelection = keepByResourceBucket(
    companionRaw,
    EQUIPMENT_STATE_LIMIT,
    4,
    { setsById, constraints, fmPolicy }
  );

  const branchOffense = {
    CRIT: distinctRows([
      doctrine.pourpre,
      doctrine.ddg,
      doctrine.turquoise,
      doctrine.mono,
      ...doctrine.damageSpecialists.slice(0, 2)
    ]),
    NO_CRIT: distinctRows([
      doctrine.pourpre,
      doctrine.ddg,
      doctrine.mono,
      ...doctrine.damageSpecialists.slice(0, 2),
      doctrine.robuste
    ])
  };

  function branchRowsAllowed(rows, branch) {
    return rows.filter((row) => dofusBranchAllows(row.item, branch));
  }

  function structuralPoolFor(baseItems, branch) {
    const stats = contextualBuildStats(baseItems, setsById, fmPolicy);
    const selected = new Map();

    const add = (row, reason) => {
      if (!row || !dofusBranchAllows(row.item, branch)) return;
      const id = String(row.item.id);
      if (!selected.has(id)) selected.set(id, { ...row, flexReason: reason });
    };

    if (effectiveStat(stats, 'ap') < Number(constraints?.ap || 0)) {
      add(doctrine.ocre, 'canonical-resource:ap');
    }
    if (effectiveStat(stats, 'mp') < Number(constraints?.mp || 0)) {
      add(doctrine.vulbis, 'canonical-resource:mp');
    }

    for (const key of positiveEquipmentConstraintKeys(constraints)) {
      if (key === 'ap' || key === 'mp') continue;
      const target = Number(constraints[key] || 0);
      if (effectiveStat(stats, key) >= target) continue;

      const helpers = doctrine.rows
        .filter((row) => dofusBranchAllows(row.item, branch))
        .filter((row) => effectiveStat(row.item.stats || {}, key) > 0)
        .sort((a, b) => effectiveStat(b.item.stats || {}, key) - effectiveStat(a.item.stats || {}, key)
          || b.objective - a.objective
          || String(a.item.id).localeCompare(String(b.item.id)))
        .slice(0, 3);
      for (const row of helpers) add(row, `explicit-constraint:${key}`);
    }

    if (baseItems.some((item) => item?.conditions)) {
      add(doctrine.dolmanax, 'condition-stat-fallback');
    }
    return [...selected.values()];
  }

  function requestedConstraintsClose(selected) {
    const stats = contextualBuildStats(selected, setsById, fmPolicy);
    return positiveEquipmentConstraintKeys(constraints)
      .every((key) => effectiveStat(stats, key) >= Number(constraints[key] || 0));
  }

  function budget2Closure(baseItems, branch) {
    const flex = structuralPoolFor(baseItems, branch);
    if (requestedConstraintsClose(baseItems)) return { closes: true, slots: 0, flex: [] };
    for (const row of flex) {
      if (requestedConstraintsClose([...baseItems, row.item])) {
        return { closes: true, slots: 1, flex: [row] };
      }
    }
    for (let left = 0; left < flex.length; left++) {
      for (let right = left + 1; right < flex.length; right++) {
        const pair = [flex[left].item, flex[right].item];
        if (!specialSlotRulesAreValid(pair)) continue;
        if (requestedConstraintsClose([...baseItems, ...pair])) {
          return { closes: true, slots: 2, flex: [flex[left], flex[right]] };
        }
      }
    }
    return { closes: false, slots: null, flex: [] };
  }

  const primaryContexts = preserveClosureAwareStates(
    companionRaw,
    legacyCompanionSelection,
    {
      limit: FINAL_CONTEXT_LIMIT,
      reserve: PRIMARY_CLOSURE_RESERVE,
      isClosable: (state) => ['CRIT', 'NO_CRIT']
        .some((branch) => budget2Closure(state.items, branch).closes),
      bucketOf: (state) => {
        const stats = contextualBuildStats(state.items, setsById, fmPolicy);
        return `${effectiveStat(stats, 'ap')}:${effectiveStat(stats, 'mp')}`;
      }
    }
  );

  function canonicalCompletions(baseItems, branch) {
    const offense = branchRowsAllowed(branchOffense[branch], branch);
    const structural = structuralPoolFor(baseItems, branch);
    const candidateMap = new Map();
    for (const row of [...offense, ...structural]) {
      if (!row) continue;
      candidateMap.set(String(row.item.id), row);
    }
    const candidates = [...candidateMap.values()];
    if (candidates.length < 6) return [];

    const offenseIds = new Set(offense.map((row) => String(row.item.id)));
    const turquoiseId = doctrine.turquoise ? String(doctrine.turquoise.item.id) : null;
    const output = [];

    for (const rows of choose(candidates, 6)) {
      const selected = rows.map((row) => row.item);
      if (!specialSlotRulesAreValid(selected)) continue;
      const ids = new Set(selected.map((item) => String(item.id)));

      if (branch === 'CRIT' && turquoiseId && !ids.has(turquoiseId)) continue;
      if (branch === 'NO_CRIT' && turquoiseId && ids.has(turquoiseId)) continue;

      const offenseCount = rows.filter((row) => offenseIds.has(String(row.item.id))).length;
      const structuralCount = 6 - offenseCount;
      if (structuralCount > MAX_STRUCTURAL_DOFUS_SLOTS) continue;
      if (!requestedConstraintsClose([...baseItems, ...selected])) continue;

      output.push({
        items: selected,
        offenseCount,
        structuralCount,
        score: objectiveForItems(selected)
      });
    }

    return output
      .sort((a, b) => b.score - a.score
        || b.offenseCount - a.offenseCount
        || itemKey(a.items).localeCompare(itemKey(b.items)))
      .slice(0, 12);
  }

  const results = [];
  const rejected = {};
  let evaluated = 0;
  let valid = 0;
  let contextsWithCompletions = 0;

  for (const context of primaryContexts) {
    for (const branch of ['CRIT', 'NO_CRIT']) {
      const completions = canonicalCompletions(context.items, branch);
      if (completions.length) contextsWithCompletions++;
      const before = contextualBuildStats(context.items, setsById, fmPolicy);

      for (const completion of completions) {
        const evaluation = evaluateCompleteEquipmentBuild({
          items: [...context.items, ...completion.items],
          sets,
          constraints,
          fmPolicy,
          syntheticOffense
        });
        evaluated++;

        if (!evaluation.result) {
          const reason = evaluation.reason || 'unknown';
          rejected[reason] = Number(rejected[reason] || 0) + 1;
          continue;
        }

        valid++;
        resultInsert(results, {
          ...evaluation.result,
          searchArchitecture: {
            pattern: context.pattern,
            branch,
            offenseDofusSlots: completion.offenseCount,
            structuralDofusSlots: completion.structuralCount,
            apBeforeDofus: effectiveStat(before, 'ap'),
            mpBeforeDofus: effectiveStat(before, 'mp')
          }
        }, Math.max(1, Number(topN || 10)));
      }
    }
  }

  const diagnostics = {
    mode: 'set-core-first-search-v1',
    applicable: true,
    primary: true,
    element: elementKey,
    setCoresConsidered: relevantCores.length,
    core2Pool: core2.length,
    core3Pool: core3.length,
    architecturesGenerated: architectureGenerated,
    architecturesRetained: architectureStates.length,
    equipmentCompletions: completeEquipment.length,
    equipmentStatesRetained: equipmentStates.length,
    companionCandidates: companionRaw.length,
    primaryClosuresRetained: primaryContexts.filter((state) =>
      ['CRIT', 'NO_CRIT'].some((branch) => budget2Closure(state.items, branch).closes)
    ).length,
    contextsWithCompletions,
    evaluated,
    authoritativeEvaluated: evaluated,
    valid,
    rejected,
    syntheticBoundUsed: false,
    fallbackRequired: results.length === 0,
    canonicalResourcePolicy: 'ocre-vulbis',
    structuralDofusBudget: MAX_STRUCTURAL_DOFUS_SLOTS
  };

  if (typeof onProgress === 'function') {
    onProgress({
      phase: 'set-core-first-search',
      label: results.length ? 'complete' : 'fallback',
      nodes: architectureGenerated,
      visited: evaluated,
      pruned: 0,
      heuristicTrimmed: Math.max(0, companionRaw.length - primaryContexts.length),
      best: results[0]?.syntheticOffense?.minimumScore || 0
    });
  }
  if (typeof onDiagnostics === 'function') onDiagnostics({ trace: [{ ...diagnostics }] });

  return {
    applicable: true,
    results,
    candidateItems: prefilter.items,
    candidatePools: prefilter.pools,
    diagnostics
  };
}
