import { BASE_CHARACTER } from './config.js';
import { addStats, cloneStats, emptyStats } from './stats.js';
import { applySetBonuses } from './sets.js';
import { optimizeCharacteristics } from './characteristics.js';
import { estimateElementValues, evaluateObjective } from './spells.js';
import { optimizeFm } from './fm.js';
import { evaluateCompleteBuild } from './complete-build-evaluator.js';
import { isPrysmaradite } from './build-legality.js';

const OFFENSIVE_SLOTS = new Set(['companion', 'dofus']);
const COMPANION_LIMIT = 30;
const DOFUS_POOL_LIMIT = 84;
const DOFUS_COMBO_LIMIT = 72;
const MAX_SKELETONS = 10;

function num(stats, key) {
  const value = Number(stats?.[key] || 0);
  return Number.isFinite(value) ? value : 0;
}

function resultKey(result) {
  return (result?.items || []).map((item) => String(item.id)).sort().join('|');
}

function resultPrysmaKey(result) {
  const prysma = (result?.items || []).find(isPrysmaradite);
  return prysma ? String(prysma.id) : 'none';
}

function skeletonKey(items = []) {
  return items
    .filter((item) => !OFFENSIVE_SLOTS.has(item.slot))
    .map((item) => String(item.id))
    .sort()
    .join('|');
}

function insertTop(results, result, limit) {
  if (!result?.items?.length) return;
  const key = resultKey(result);
  const previous = results.findIndex((entry) => resultKey(entry) === key);
  if (previous >= 0) {
    if (results[previous].score >= result.score) return;
    results.splice(previous, 1);
  }
  results.push(result);
  results.sort((a, b) => b.score - a.score);
  if (results.length > limit) results.length = limit;
}

function rememberBestPrysma(map, result) {
  if (!result?.items?.length) return;
  const key = resultPrysmaKey(result);
  const previous = map.get(key);
  if (!previous || Number(result.score || 0) > Number(previous.score || 0)) map.set(key, result);
}

function mergeRetainingPrysmas(ranked, bestByPrysma, limit) {
  const cap = Math.max(1, Number(limit || 10));
  const reserved = [...bestByPrysma.values()]
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
    .slice(0, Math.min(cap, bestByPrysma.size));
  const output = [];
  const seen = new Set();
  for (const result of [...reserved, ...ranked]) {
    const key = resultKey(result);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(result);
    if (output.length >= cap) break;
  }
  return output;
}

function staticStats(items, setsById) {
  const stats = emptyStats();
  addStats(stats, BASE_CHARACTER.baseStats || {});
  for (const item of items || []) addStats(stats, item.stats || {});
  applySetBonuses(stats, items || [], setsById);
  return stats;
}

function permanentReady(items, setsById, constraints = {}) {
  const stats = staticStats(items, setsById);
  return num(stats, 'ap') >= Math.max(0, Number(constraints.ap || 0))
    && num(stats, 'mp') >= Math.max(0, Number(constraints.mp || 0));
}

function buildReferenceStats({ skeleton, setsById, selections, constraints, fmPolicy, turnMode, scenario }) {
  const raw = staticStats(skeleton, setsById);
  const characteristic = optimizeCharacteristics(raw, {
    points: BASE_CHARACTER.characteristicPoints,
    scrolled: BASE_CHARACTER.scrolled,
    elementValues: estimateElementValues(selections, {}),
    minimumVitality: constraints.vit || 0,
    baseVitality: 0
  });
  const fm = optimizeFm({
    baseStats: characteristic.stats,
    items: skeleton,
    selections,
    turnMode,
    policy: { ...fmPolicy, structuralExos: false },
    scenario
  });
  return fm?.stats || characteristic.stats;
}

function objectiveScore(stats, items, selections, turnMode, scenario) {
  return evaluateObjective({ stats, items, selections, turnMode, scenario }).score;
}

function itemProfile(item, referenceStats, baseItems, baseline, selections, turnMode, scenario) {
  const stats = cloneStats(referenceStats);
  addStats(stats, item.stats || {});
  const score = objectiveScore(stats, [...baseItems, item], selections, turnMode, scenario);
  const prysma = isPrysmaradite(item);
  return {
    item,
    gain: Number.isFinite(score) ? score - baseline : -Infinity,
    ap: num(item.stats, 'ap'),
    mp: num(item.stats, 'mp'),
    crit: num(item.stats, 'crit'),
    prysma: prysma ? 1 : 0,
    prysmaId: prysma ? String(item.id) : 'none'
  };
}

function usefulOffensiveProfile(profile) {
  const gain = Number(profile?.gain);
  return (Number.isFinite(gain) && gain > 0.001)
    || Number(profile?.ap || 0) !== 0
    || Number(profile?.mp || 0) !== 0
    || Number(profile?.prysma || 0) > 0;
}

function uniqueProfiles(groups, limit) {
  const seen = new Set();
  const output = [];
  for (const profile of groups.flat()) {
    if (!profile?.item) continue;
    const id = String(profile.item.id);
    if (seen.has(id)) continue;
    seen.add(id);
    output.push(profile);
    if (output.length >= limit) break;
  }
  return output;
}

function topBy(profiles, getter, limit = 8) {
  return [...profiles]
    .filter((profile) => Number.isFinite(getter(profile)) && getter(profile) > 0)
    .sort((a, b) => getter(b) - getter(a) || b.gain - a.gain)
    .slice(0, limit);
}

function topByGainWhere(profiles, predicate, limit = 8) {
  return [...profiles]
    .filter(predicate)
    .sort((a, b) => b.gain - a.gain)
    .slice(0, limit);
}

function topByAnyElement(profiles, limit = 8) {
  return topBy(profiles, (profile) => Math.max(
    num(profile.item.stats, 'earth'),
    num(profile.item.stats, 'fire'),
    num(profile.item.stats, 'water'),
    num(profile.item.stats, 'air')
  ), limit);
}

function topByAnyElementDamage(profiles, limit = 8) {
  return topBy(profiles, (profile) => Math.max(
    num(profile.item.stats, 'damageEarth'),
    num(profile.item.stats, 'damageFire'),
    num(profile.item.stats, 'damageWater'),
    num(profile.item.stats, 'damageAir')
  ), limit);
}

function companionPool(items, referenceStats, skeleton, selections, turnMode, scenario, currentIds) {
  const baseline = objectiveScore(referenceStats, skeleton, selections, turnMode, scenario);
  const profiles = items
    .filter((item) => item.slot === 'companion')
    .map((item) => itemProfile(item, referenceStats, skeleton, baseline, selections, turnMode, scenario));
  const byGain = [...profiles].sort((a, b) => b.gain - a.gain);
  const current = profiles.filter((profile) => currentIds.has(String(profile.item.id)));
  return uniqueProfiles([
    current,
    byGain.slice(0, 14),
    // Keep both crit and non-crit companion archetypes alive until the exact
    // combat pass. Otherwise one synthetic reference can crowd out the other
    // before temporary 100%-crit effects are known.
    topByGainWhere(profiles, (p) => p.crit > 0, 8),
    topByGainWhere(profiles, (p) => p.crit <= 0, 8),
    topBy(profiles, (p) => num(p.item.stats, 'crit'), 8),
    topBy(profiles, (p) => num(p.item.stats, 'critDamage'), 8),
    topBy(profiles, (p) => num(p.item.stats, 'power'), 8),
    topBy(profiles, (p) => num(p.item.stats, 'spellDamagePct'), 8),
    topBy(profiles, (p) => num(p.item.stats, 'meleeDamagePct'), 6),
    topBy(profiles, (p) => num(p.item.stats, 'rangedDamagePct'), 6),
    topByAnyElement(profiles, 8),
    topByAnyElementDamage(profiles, 8),
    topBy(profiles, (p) => p.ap, 4),
    topBy(profiles, (p) => p.mp, 4)
  ], COMPANION_LIMIT);
}

function dofusPool(items, referenceStats, baseItems, selections, turnMode, scenario, currentIds) {
  const baseline = objectiveScore(referenceStats, baseItems, selections, turnMode, scenario);
  const profiles = items
    .filter((item) => item.slot === 'dofus')
    .map((item) => itemProfile(item, referenceStats, baseItems, baseline, selections, turnMode, scenario));

  // A Prysmaradite can be weak on isolated-hit scoring but decisive once its
  // temporary AP changes the real rotation. Keep every certified offensive
  // Prysmaradite in the bench and let the final combat solver judge it.
  const usefulProfiles = profiles.filter(usefulOffensiveProfile);
  const candidates = usefulProfiles.length >= 6 ? usefulProfiles : profiles;
  const byGain = [...candidates].sort((a, b) => b.gain - a.gain);
  const current = candidates.filter((profile) => currentIds.has(String(profile.item.id)));
  const allPrysmas = candidates
    .filter((profile) => profile.prysma)
    .sort((a, b) => b.gain - a.gain);
  const realDofus = byGain
    .filter((profile) => String(profile.item.typeName || '').toLowerCase().includes('dofus'))
    .slice(0, 20);
  return uniqueProfiles([
    current,
    allPrysmas,
    byGain.slice(0, 30),
    // Same rule for Dofus/trophies: preserve both branches. The exact turn
    // solver, not the API stat shape, decides whether static crit is useful.
    topByGainWhere(candidates, (p) => p.crit > 0, 12),
    topByGainWhere(candidates, (p) => p.crit <= 0, 12),
    topBy(candidates, (p) => num(p.item.stats, 'power'), 10),
    topBy(candidates, (p) => num(p.item.stats, 'crit'), 10),
    topBy(candidates, (p) => num(p.item.stats, 'critDamage'), 10),
    topBy(candidates, (p) => num(p.item.stats, 'damage'), 10),
    topBy(candidates, (p) => num(p.item.stats, 'spellDamagePct'), 10),
    topBy(candidates, (p) => num(p.item.stats, 'meleeDamagePct'), 8),
    topBy(candidates, (p) => num(p.item.stats, 'rangedDamagePct'), 8),
    topByAnyElement(candidates, 10),
    topByAnyElementDamage(candidates, 10),
    topBy(candidates, (p) => p.ap, 10),
    topBy(candidates, (p) => p.mp, 10),
    realDofus
  ], DOFUS_POOL_LIMIT);
}

function comboKey(items) {
  return items.map((item) => String(item.id)).sort().join('|');
}

function critBand(crit) {
  const value = Number.isFinite(Number(crit)) ? Number(crit) : 0;
  return Math.max(-8, Math.min(16, Math.round(value / 5)));
}

function apMpBucket(ap, mp, prysmaId, crit) {
  return `${Math.max(-3, Math.min(4, ap))}:${Math.max(-3, Math.min(4, mp))}:${prysmaId || 'none'}:c${critBand(crit)}`;
}

function keepComboDiversity(states, limit) {
  states.sort((a, b) => b.score - a.score);
  const perBucket = new Map();
  const output = [];
  const seen = new Set();
  for (const state of states) {
    const key = comboKey(state.items);
    if (seen.has(key)) continue;
    const bucket = apMpBucket(state.ap, state.mp, state.prysmaId, state.crit);
    const used = perBucket.get(bucket) || 0;
    if (used >= 20) continue;
    seen.add(key);
    perBucket.set(bucket, used + 1);
    output.push(state);
    if (output.length >= limit) break;
  }
  return output;
}

function dofusCombinations(profiles, count = 6) {
  if (profiles.length < count) return [];
  const ordered = [...profiles].sort((a, b) => String(a.item.id).localeCompare(String(b.item.id)));
  let states = [{ items: [], score: 0, ap: 0, mp: 0, crit: 0, prysmaCount: 0, prysmaId: 'none', next: 0 }];
  for (let pick = 0; pick < count; pick++) {
    const nextStates = [];
    const left = count - pick - 1;
    for (const state of states) {
      const last = ordered.length - left;
      for (let index = state.next; index < last; index++) {
        const profile = ordered[index];
        const prysmaCount = state.prysmaCount + profile.prysma;
        if (prysmaCount > 1) continue;
        nextStates.push({
          items: [...state.items, profile.item],
          score: state.score + profile.gain,
          ap: state.ap + profile.ap,
          mp: state.mp + profile.mp,
          crit: state.crit + profile.crit,
          prysmaCount,
          prysmaId: profile.prysma ? profile.prysmaId : state.prysmaId,
          next: index + 1
        });
      }
    }
    states = keepComboDiversity(nextStates, pick === count - 1 ? 760 : 920);
    if (!states.length) break;
  }
  return keepComboDiversity(states, 760);
}

function preservePrysmaCombos(combos, limit) {
  const output = [];
  const seen = new Set();
  const bestByPrysma = new Map();
  for (const combo of combos) {
    const key = combo.prysmaId || 'none';
    if (!bestByPrysma.has(key)) bestByPrysma.set(key, combo);
  }
  for (const combo of [...bestByPrysma.values(), ...combos]) {
    const key = comboKey(combo.items);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(combo);
    if (output.length >= limit) break;
  }
  return output;
}

function selectFinalCombos(combos, fixedItems, setsById, constraints) {
  const ready = [];
  const fallback = [];
  for (const combo of combos) {
    const items = [...fixedItems, ...combo.items];
    if (permanentReady(items, setsById, constraints)) ready.push(combo);
    else fallback.push(combo);
  }
  ready.sort((a, b) => b.score - a.score);
  fallback.sort((a, b) => b.score - a.score);
  return preservePrysmaCombos(ready.length ? ready : fallback, DOFUS_COMBO_LIMIT);
}

export function refineOffensiveSlots({
  results = [],
  items = [],
  sets = [],
  selections = [],
  constraints = {},
  fmPolicy = {},
  turnMode = 'sum',
  scenario = {},
  topN = 10,
  preservePrysmaradites = false,
  onProgress = null
} = {}) {
  if (!results.length) return { results: [], diagnostics: { refined: 0, evaluated: 0, skeletons: 0 } };

  const limit = Math.max(1, Number(topN || 10));
  const setsById = Object.fromEntries((sets || []).map((set) => [set.id, set]));
  const refined = [];
  const bestByPrysma = new Map();
  for (const result of results) {
    insertTop(refined, result, limit);
    if (preservePrysmaradites) rememberBestPrysma(bestByPrysma, result);
  }

  const uniqueSkeletons = [];
  const seenSkeletons = new Set();
  for (const result of results) {
    const key = skeletonKey(result.items);
    if (!key || seenSkeletons.has(key)) continue;
    seenSkeletons.add(key);
    uniqueSkeletons.push(result);
    if (uniqueSkeletons.length >= MAX_SKELETONS) break;
  }

  let evaluated = 0;
  for (let skeletonIndex = 0; skeletonIndex < uniqueSkeletons.length; skeletonIndex++) {
    const source = uniqueSkeletons[skeletonIndex];
    const skeleton = source.items.filter((item) => !OFFENSIVE_SLOTS.has(item.slot));
    const currentIds = new Set(source.items.map((item) => String(item.id)));
    const reference = buildReferenceStats({ skeleton, setsById, selections, constraints, fmPolicy, turnMode, scenario });
    const companions = companionPool(items, reference, skeleton, selections, turnMode, scenario, currentIds);

    for (const companionProfile of companions) {
      const companion = companionProfile.item;
      const companionStats = cloneStats(reference);
      addStats(companionStats, companion.stats || {});
      const baseItems = [...skeleton, companion];
      const dofusProfiles = dofusPool(items, companionStats, baseItems, selections, turnMode, scenario, currentIds);
      const combos = selectFinalCombos(dofusCombinations(dofusProfiles), baseItems, setsById, constraints);

      for (const combo of combos) {
        const fullItems = [...baseItems, ...combo.items];
        if (!permanentReady(fullItems, setsById, constraints)) continue;
        const evaluation = evaluateCompleteBuild({
          items: fullItems,
          sets,
          selections,
          constraints,
          fmPolicy: { ...fmPolicy, structuralExos: false },
          turnMode,
          scenario
        });
        evaluated++;
        if (!evaluation.result) continue;
        insertTop(refined, evaluation.result, limit);
        if (preservePrysmaradites) rememberBestPrysma(bestByPrysma, evaluation.result);
      }
    }

    if (onProgress) {
      const partialResults = preservePrysmaradites
        ? mergeRetainingPrysmas(refined, bestByPrysma, limit)
        : [...refined];
      onProgress({
        phase: 'offensive-refine',
        label: `raffinage dégâts ${skeletonIndex + 1}/${uniqueSkeletons.length}`,
        nodes: evaluated,
        visited: partialResults.length,
        pruned: 0,
        best: refined[0]?.score || 0,
        partialResults
      });
    }
  }

  const finalResults = preservePrysmaradites
    ? mergeRetainingPrysmas(refined, bestByPrysma, limit)
    : refined;

  return {
    results: finalResults,
    diagnostics: {
      refined: finalResults.length,
      evaluated,
      skeletons: uniqueSkeletons.length,
      prysmaraditeVariants: preservePrysmaradites ? bestByPrysma.size : 0
    }
  };
}