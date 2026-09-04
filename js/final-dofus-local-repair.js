import { evaluateCompleteBuild } from './complete-build-evaluator.js';
import { refineCombatTurns } from './combat-turn-refiner.js';
import { getSearchProfile } from '../optimizer/search-profiles.js';

const REFINED_SLOTS = new Set(['companion', 'dofus']);

function itemId(item) {
  return String(item?.id || '');
}

function buildKey(build) {
  return (build?.items || []).map(itemId).sort().join('|');
}

function skeletonKey(items = []) {
  return items
    .filter((item) => !REFINED_SLOTS.has(item?.slot))
    .map(itemId)
    .sort()
    .join('|');
}

function sameDofusIdentity(left, right) {
  if (!left || !right) return false;
  if (itemId(left) && itemId(left) === itemId(right)) return true;
  if (left.ankamaId != null && right.ankamaId != null && String(left.ankamaId) === String(right.ankamaId)) return true;
  return Boolean(left.name && right.name && String(left.name) === String(right.name));
}

function hasDuplicateDofus(items = []) {
  const dofus = items.filter((item) => item?.slot === 'dofus');
  for (let index = 0; index < dofus.length; index++) {
    for (let other = index + 1; other < dofus.length; other++) {
      if (sameDofusIdentity(dofus[index], dofus[other])) return true;
    }
  }
  return false;
}

function strictBetter(left, right) {
  return Number(left?.score || 0) > Number(right?.score || 0);
}

function stableBest(results = []) {
  return [...results].sort((left, right) => Number(right?.score || 0) - Number(left?.score || 0)
    || Number(right?.equipmentScore || 0) - Number(left?.equipmentScore || 0)
    || buildKey(left).localeCompare(buildKey(right)))[0] || null;
}

function scoreAllCanonically(results, context, refineFinal) {
  if (!results.length) return [];
  const mode = String(context.combatObjective?.turnMode || context.turnMode || 't1');
  const multiTurn = ['sum', 'average', 'min', 'constant'].includes(mode);
  const profile = getSearchProfile(context.searchProfile);
  const chunkSize = multiTurn
    ? Math.max(1, Number(profile.combat.preciseCandidateCeiling || 1))
    : results.length;
  const scored = [];

  for (let offset = 0; offset < results.length; offset += chunkSize) {
    const chunk = results.slice(offset, offset + chunkSize);
    const refined = refineFinal({
      results: chunk,
      spells: context.spells,
      combatObjective: { ...context.combatObjective, turnMode: mode },
      scenario: context.scenario,
      topN: chunk.length,
      preservePrysmaradites: false,
      searchProfile: context.searchProfile
    });
    scored.push(...(refined?.results || []));
  }
  return scored;
}

function setCounts(items = []) {
  const counts = new Map();
  for (const item of items) {
    if (!item?.setId || REFINED_SLOTS.has(item.slot)) continue;
    counts.set(String(item.setId), (counts.get(String(item.setId)) || 0) + 1);
  }
  return counts;
}

function respectsLocks(items, required, rejected) {
  if ((items || []).some((item) => rejected.has(itemId(item)))) return false;
  for (const id of required) if (!(items || []).some((item) => itemId(item) === id)) return false;
  return true;
}

function completeBuildRecoverySeeds(build, candidateItems, required, rejected, searchProfile) {
  const profile = getSearchProfile(searchProfile);
  const budget = Math.max(2, Math.ceil(Number(profile.refine.maxSkeletons || 4) / 3));
  const baseCounts = setCounts(build.items);
  const seeds = [{ ...build, recoveryOpportunity: Infinity }];
  const seen = new Set([skeletonKey(build.items)]);
  const structuralPool = (candidateItems || [])
    .filter((item) => item && !REFINED_SLOTS.has(item.slot) && !rejected.has(itemId(item)))
    .sort((left, right) => itemId(left).localeCompare(itemId(right)));

  for (let index = 0; index < build.items.length; index++) {
    const from = build.items[index];
    if (!from || REFINED_SLOTS.has(from.slot) || required.has(itemId(from))) continue;

    for (const to of structuralPool) {
      if (to.slot !== from.slot || itemId(to) === itemId(from) || !to.setId) continue;
      if (build.items.some((item, itemIndex) => itemIndex !== index && itemId(item) === itemId(to))) continue;
      const targetSet = String(to.setId);
      const before = Number(baseCounts.get(targetSet) || 0);
      const after = before + 1 - (String(from.setId || '') === targetSet ? 1 : 0);
      // Recovery is deliberately narrow: only restore/deepen a set synergy that
      // already has another equipped piece. Standalone structural exploration
      // remains owned by the main architecture search.
      if (before < 1 || after <= before) continue;

      const items = [...build.items];
      items[index] = to;
      if (!respectsLocks(items, required, rejected)) continue;
      const key = skeletonKey(items);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      seeds.push({
        ...build,
        items,
        score: Number.NEGATIVE_INFINITY,
        equipmentScore: Number.NEGATIVE_INFINITY,
        recoveryOpportunity: after
      });
    }
  }

  const original = seeds[0];
  const challengers = seeds.slice(1)
    .sort((left, right) => Number(right.recoveryOpportunity || 0) - Number(left.recoveryOpportunity || 0)
      || skeletonKey(left.items).localeCompare(skeletonKey(right.items)))
    .slice(0, Math.max(0, budget - 1));
  return [original, ...challengers];
}

function selectionsFromFinalPlan(build, spells = [], fallback = []) {
  const sequence = build?.combatPlan?.sequence || [];
  if (!sequence.length || !spells.length) return fallback;
  const casts = new Map();
  for (const action of sequence) {
    const key = String(action?.spellId || '');
    if (!key) continue;
    const entry = casts.get(key) || { 1: 0, 2: 0, 3: 0 };
    const turn = Math.max(1, Math.min(3, Number(action?.turn || 1)));
    entry[turn] += 1;
    casts.set(key, entry);
  }
  const selected = spells
    .filter((spell) => casts.has(String(spell?.id || '')))
    .map((spell) => ({ spell: { ...spell }, enabled: true, weight: 1, casts: casts.get(String(spell.id)) }));
  return selected.length ? selected : fallback;
}

function dofusVariants(build, pool, required, rejected) {
  const current = build.items.filter((item) => item?.slot === 'dofus');
  const variants = [{ items: current, label: 'current' }];
  const seen = new Set([current.map(itemId).sort().join('|')]);

  for (let index = 0; index < current.length; index++) {
    const from = current[index];
    if (required.has(itemId(from))) continue;
    for (const to of pool) {
      if (sameDofusIdentity(from, to)) continue;
      const items = [...current];
      items[index] = to;
      if (hasDuplicateDofus(items) || items.some((item) => rejected.has(itemId(item)))) continue;
      const key = items.map(itemId).sort().join('|');
      if (!key || seen.has(key)) continue;
      seen.add(key);
      variants.push({ items, label: `${from.name || itemId(from)} -> ${to.name || itemId(to)}` });
    }
  }
  return variants;
}

function insertRecoveryTop(entries, entry, limit) {
  if (!entry?.result?.items?.length) return;
  const key = buildKey(entry.result);
  const previous = entries.findIndex((candidate) => buildKey(candidate.result) === key);
  if (previous >= 0) {
    if (Number(entries[previous].result.score || 0) >= Number(entry.result.score || 0)) return;
    entries.splice(previous, 1);
  }
  entries.push(entry);
  entries.sort((left, right) => Number(right.result.score || 0) - Number(left.result.score || 0)
    || buildKey(left.result).localeCompare(buildKey(right.result)));
  if (entries.length > limit) entries.length = limit;
}

export function repairFinalDofusBuild({
  build,
  candidateItems = [],
  sets = [],
  selections = [],
  constraints = {},
  fmPolicy = {},
  turnMode = 't1',
  scenario = {},
  spells = [],
  combatObjective = {},
  searchProfile = 'BALANCED',
  requiredItemIds = [],
  rejectedItemIds = [],
  evaluateComplete = evaluateCompleteBuild,
  refineFinal = refineCombatTurns
} = {}) {
  if (!build?.items?.length) {
    return { result: build || null, diagnostics: { changed: false, evaluated: 0, legal: 0, reason: 'no-build' } };
  }

  const required = new Set((requiredItemIds || []).map(String));
  const rejected = new Set((rejectedItemIds || []).map(String));
  const pool = (candidateItems || [])
    .filter((item) => item?.slot === 'dofus' && !rejected.has(itemId(item)))
    .sort((left, right) => itemId(left).localeCompare(itemId(right)));
  const dofusIndexes = build.items
    .map((item, index) => item?.slot === 'dofus' ? index : -1)
    .filter((index) => index >= 0);

  const evaluatedByKey = new Map();
  let attempted = 0;
  let legal = 0;
  const rejectedReasons = {};

  // Keep the cheap distance-1 Dofus safety net: every legal single swap is
  // compared with the real final combat evaluator.
  for (const index of dofusIndexes) {
    const from = build.items[index];
    if (required.has(itemId(from))) continue;

    for (const to of pool) {
      if (sameDofusIdentity(from, to)) continue;
      if (build.items.some((item, itemIndex) => itemIndex !== index && item?.slot === 'dofus' && sameDofusIdentity(item, to))) continue;

      const neighborItems = [...build.items];
      neighborItems[index] = to;
      if (neighborItems.length !== build.items.length || hasDuplicateDofus(neighborItems)) continue;
      if (!respectsLocks(neighborItems, required, rejected)) continue;

      attempted++;
      const evaluation = evaluateComplete({
        items: neighborItems,
        sets,
        selections,
        constraints,
        fmPolicy: { ...fmPolicy, structuralExos: false },
        turnMode,
        scenario
      });
      if (!evaluation?.result) {
        const reason = String(evaluation?.reason || 'invalid');
        rejectedReasons[reason] = Number(rejectedReasons[reason] || 0) + 1;
        continue;
      }
      legal++;
      const key = buildKey(evaluation.result);
      if (!key || evaluatedByKey.has(key)) continue;
      evaluatedByKey.set(key, {
        result: evaluation.result,
        from: from.name || itemId(from),
        to: to.name || itemId(to),
        recovery: 'dofus-distance-1'
      });
    }
  }

  // Complete-build recovery deliberately bypasses the earlier Dofus-combination
  // beam. Around the final winner it enumerates every one-Dofus redistribution
  // together with each retained companion, on the original skeleton and a few
  // one-slot skeletons that restore an existing set synergy. The equipment
  // pre-score uses the actual winning rotation when available; only a bounded
  // shortlist reaches the expensive final combat evaluator.
  const recoverySeeds = completeBuildRecoverySeeds(build, candidateItems, required, rejected, searchProfile);
  const companionPool = (candidateItems || [])
    .filter((item) => item?.slot === 'companion' && !rejected.has(itemId(item)))
    .sort((left, right) => itemId(left).localeCompare(itemId(right)));
  const currentCompanion = build.items.find((item) => item?.slot === 'companion');
  if (currentCompanion && !companionPool.some((item) => itemId(item) === itemId(currentCompanion))) companionPool.unshift(currentCompanion);
  const variants = dofusVariants(build, pool, required, rejected);
  const recoverySelections = selectionsFromFinalPlan(build, spells, selections);
  const profile = getSearchProfile(searchProfile);
  const recoveryTopN = Math.max(
    Number(profile.combat.preciseCandidateCeiling || 10),
    recoverySeeds.length * 6
  );
  const recoveryEntries = [];
  let recoveryEvaluated = 0;
  let recoveryLegal = 0;

  if (companionPool.length && variants.length) {
    for (const seed of recoverySeeds) {
      const skeleton = seed.items.filter((item) => !REFINED_SLOTS.has(item?.slot));
      for (const companion of companionPool) {
        for (const variant of variants) {
          const items = [...skeleton, companion, ...variant.items];
          if (!respectsLocks(items, required, rejected)) continue;
          recoveryEvaluated++;
          const evaluation = evaluateComplete({
            items,
            sets,
            selections: recoverySelections,
            constraints,
            fmPolicy: { ...fmPolicy, structuralExos: false },
            turnMode,
            scenario
          });
          if (!evaluation?.result) continue;
          recoveryLegal++;
          insertRecoveryTop(recoveryEntries, {
            result: evaluation.result,
            recovery: 'complete-build-neighborhood',
            companion: companion.name || itemId(companion),
            dofusChange: variant.label,
            skeletonChanged: skeletonKey(seed.items) !== skeletonKey(build.items)
          }, recoveryTopN);
        }
      }
    }
  }

  for (const entry of recoveryEntries) {
    const key = buildKey(entry.result);
    if (!key || key === buildKey(build) || evaluatedByKey.has(key)) continue;
    evaluatedByKey.set(key, entry);
  }

  const legalEntries = [...evaluatedByKey.values()];
  const scored = scoreAllCanonically(
    legalEntries.map((entry) => entry.result),
    { spells, combatObjective, turnMode, scenario, searchProfile },
    refineFinal
  );
  const best = stableBest(scored);
  if (!best || !strictBetter(best, build)) {
    return {
      result: build,
      diagnostics: {
        changed: false,
        pool: pool.length,
        attempted,
        legal,
        finalScored: scored.length,
        recoverySkeletons: recoverySeeds.length,
        recoveryEvaluated,
        recoveryLegal,
        recoveryCandidates: recoveryEntries.length,
        rejected: rejectedReasons
      }
    };
  }

  const swap = evaluatedByKey.get(buildKey(best));
  return {
    result: best,
    diagnostics: {
      changed: true,
      pool: pool.length,
      attempted,
      legal,
      finalScored: scored.length,
      recoverySkeletons: recoverySeeds.length,
      recoveryEvaluated,
      recoveryLegal,
      recoveryCandidates: recoveryEntries.length,
      rejected: rejectedReasons,
      recovery: swap?.recovery || null,
      from: swap?.from || null,
      to: swap?.to || null,
      companion: swap?.companion || null,
      dofusChange: swap?.dofusChange || null,
      skeletonChanged: Boolean(swap?.skeletonChanged),
      beforeScore: Number(build.score || 0),
      afterScore: Number(best.score || 0),
      delta: Number(best.score || 0) - Number(build.score || 0)
    }
  };
}
