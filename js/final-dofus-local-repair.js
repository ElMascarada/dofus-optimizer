import { evaluateCompleteBuild } from './complete-build-evaluator.js';
import { refineCombatTurns } from './combat-turn-refiner.js';
import { getSearchProfile } from '../optimizer/search-profiles.js';

function itemId(item) {
  return String(item?.id || '');
}

function buildKey(build) {
  return (build?.items || []).map(itemId).sort().join('|');
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

  for (const index of dofusIndexes) {
    const from = build.items[index];
    if (required.has(itemId(from))) continue;

    for (const to of pool) {
      if (sameDofusIdentity(from, to)) continue;
      if (build.items.some((item, itemIndex) => itemIndex !== index && item?.slot === 'dofus' && sameDofusIdentity(item, to))) continue;

      const neighborItems = [...build.items];
      neighborItems[index] = to;
      if (neighborItems.length !== build.items.length || hasDuplicateDofus(neighborItems)) continue;
      if ([...required].some((id) => !neighborItems.some((item) => itemId(item) === id))) continue;
      if (neighborItems.some((item) => rejected.has(itemId(item)))) continue;

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
        to: to.name || itemId(to)
      });
    }
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
      rejected: rejectedReasons,
      from: swap?.from || null,
      to: swap?.to || null,
      beforeScore: Number(build.score || 0),
      afterScore: Number(best.score || 0),
      delta: Number(best.score || 0) - Number(build.score || 0)
    }
  };
}
