import { evaluateCompleteBuild } from './complete-build-evaluator.js';
import { isPrysmaradite } from './build-legality.js';
import { createCandidatePolicy } from '../optimizer/candidate-policy.js';
import { buildGroupChoices } from '../optimizer/candidate-search.js';
import { getSearchProfile } from '../optimizer/search-profiles.js';

const REFINED_SLOTS = new Set(['companion', 'dofus']);

function resultKey(result) {
  return (result?.items || []).map((item) => String(item.id)).sort().join('|');
}

function resultPrysmaKey(result) {
  const prysma = (result?.items || []).find(isPrysmaradite);
  return prysma ? String(prysma.id) : 'none';
}

function skeletonKey(items = []) {
  return items
    .filter((item) => !REFINED_SLOTS.has(item.slot))
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
  searchProfile = 'BALANCED',
  onProgress = null
} = {}) {
  if (!results.length) return { results: [], diagnostics: { refined: 0, evaluated: 0, skeletons: 0 } };

  const profile = getSearchProfile(searchProfile);
  const policy = createCandidatePolicy({
    items,
    sets,
    selections,
    constraints,
    turnMode,
    scenario,
    searchProfile: profile
  });
  const companions = items
    .filter((item) => item.slot === 'companion')
    .map((item) => policy.profileItem(item))
    .sort((a, b) => b.rankScore - a.rankScore || String(a.item.id).localeCompare(String(b.item.id)));
  const dofusProfiles = items
    .filter((item) => item.slot === 'dofus')
    .map((item) => policy.profileItem(item))
    .sort((a, b) => b.rankScore - a.rankScore || String(a.item.id).localeCompare(String(b.item.id)));
  const dofusChoices = buildGroupChoices(dofusProfiles, 6, {
    policy,
    profile,
    constraints,
    turnMode,
    scenario,
    slot: 'dofus'
  }).slice(0, profile.refine.dofusComboLimit);

  const limit = Math.max(1, Number(topN || 10));
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
    if (uniqueSkeletons.length >= profile.refine.maxSkeletons) break;
  }

  let evaluated = 0;
  for (let skeletonIndex = 0; skeletonIndex < uniqueSkeletons.length; skeletonIndex++) {
    const source = uniqueSkeletons[skeletonIndex];
    const skeleton = source.items.filter((item) => !REFINED_SLOTS.has(item.slot));

    for (const companion of companions) {
      for (const choice of dofusChoices) {
        const evaluation = evaluateCompleteBuild({
          items: [...skeleton, companion.item, ...choice.items],
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
      companionCandidates: companions.length,
      dofusCandidates: dofusProfiles.length,
      dofusCombinations: dofusChoices.length,
      prysmaraditeVariants: preservePrysmaradites ? bestByPrysma.size : 0
    }
  };
}
