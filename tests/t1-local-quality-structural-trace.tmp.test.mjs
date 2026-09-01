import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createOptimizerV2Request } from '../js/optimizer-v2-orchestrator.js';
import { prefilterItems } from '../js/candidate-prefilter.js';

const WINNER_NAMES = [
  'Dofus Nébuleux',
  'Dofus Ocre',
  'Dofus Pourpre',
  'Dofus Émeraude',
  'Savant majeur',
  'Ravageur Feu majeur'
];

function key(ids = []) {
  return ids.map(String).sort().join('|');
}

test('diagnostic: trace beam4 added-item versus exact-parent coverage', async () => {
  const sourcePath = fileURLToPath(new URL('../optimizer/candidate-search.js', import.meta.url));
  const tempPath = fileURLToPath(new URL(`../optimizer/.candidate-search-structural-trace-${process.pid}-${Date.now()}.mjs`, import.meta.url));
  const source = readFileSync(sourcePath, 'utf8');
  const traceNeedle = `  const protectedStates = parentChildRepresentatives(marginalPool, reserveLimit, context)\n    .map((state) => originalByKey.get(choiceKey(state.items)))\n    .filter(Boolean);\n\n  let output;`;
  assert.equal(source.includes(traceNeedle), true, 'candidate-search protected reserve shape changed');

  const instrumented = source.replace(
    traceNeedle,
    `  const protectedStates = parentChildRepresentatives(marginalPool, reserveLimit, context)\n    .map((state) => originalByKey.get(choiceKey(state.items)))\n    .filter(Boolean);\n\n  if (typeof context.onDofusStructuralTrace === 'function') {\n    const traceChildKey = String(context.traceChildKey || '');\n    const parentKeySet = new Set(parentStates.map((state) => choiceKey(state.items)));\n    const primaryParentKeys = new Set(retained.map((state) => parentChoiceKey(state)).filter(Boolean));\n\n    const addedItemKey = (state) => {\n      if (!state) return null;\n      const exactParent = parentByKey.get(parentChoiceKey(state));\n      if (!exactParent) return null;\n      const parentItemIds = new Set((exactParent.items || []).map((item) => String(item.id)));\n      const addedIds = (state.items || [])\n        .map((item) => String(item.id))\n        .filter((id) => !parentItemIds.has(id))\n        .sort();\n      return addedIds.length ? addedIds.join('|') : null;\n    };\n\n    const distinctAddedItemCount = (list) => new Set(list.map(addedItemKey).filter(Boolean)).size;\n    const winnerChild = states.find((state) => choiceKey(state.items) === traceChildKey) || null;\n    const winnerAddedItemKey = addedItemKey(winnerChild);\n    const winnerAddedMarginalStates = winnerAddedItemKey\n      ? marginalPool.filter((state) => addedItemKey(state) === winnerAddedItemKey)\n      : [];\n    const winnerAddedByObjective = [...winnerAddedMarginalStates].sort((a, b) => b.objectiveScore - a.objectiveScore\n      || b.score - a.score\n      || choiceKey(a.items).localeCompare(choiceKey(b.items)));\n    const winnerAddedByProxy = [...winnerAddedMarginalStates].sort((a, b) => b.score - a.score\n      || b.objectiveScore - a.objectiveScore\n      || choiceKey(a.items).localeCompare(choiceKey(b.items)));\n    const oneBasedRank = (list, targetKey) => {\n      const index = list.findIndex((state) => choiceKey(state.items) === targetKey);\n      return index >= 0 ? index + 1 : null;\n    };\n    const winnerAddedItemDistinctParents = new Set(winnerAddedMarginalStates\n      .map((state) => parentChoiceKey(state))\n      .filter(Boolean));\n    const protectedParentKeys = new Set(protectedStates.map((state) => parentChoiceKey(state)).filter(Boolean));\n    const unrepresentedParentKeys = new Set([...parentKeySet].filter((parentKey) => !primaryParentKeys.has(parentKey)));\n\n    context.onDofusStructuralTrace({\n      MARGINAL_POOL_DISTINCT_PARENT_COUNT: new Set(marginalPool.map((state) => parentChoiceKey(state)).filter(Boolean)).size,\n      MARGINAL_POOL_DISTINCT_ADDED_ITEM_COUNT: distinctAddedItemCount(marginalPool),\n      PRIMARY_BEAM4_DISTINCT_PARENT_COUNT: primaryParentKeys.size,\n      PRIMARY_BEAM4_DISTINCT_ADDED_ITEM_COUNT: distinctAddedItemCount(retained),\n      UNREPRESENTED_PARENT_COUNT: unrepresentedParentKeys.size,\n      WINNER_ADDED_ITEM_KEY: winnerAddedItemKey,\n      WINNER_ADDED_ITEM_POOL_COUNT: winnerAddedMarginalStates.length,\n      WINNER_ADDED_ITEM_PRIMARY_COUNT: winnerAddedItemKey\n        ? retained.filter((state) => addedItemKey(state) === winnerAddedItemKey).length\n        : 0,\n      WINNER_ADDED_ITEM_PROTECTED_COUNT: winnerAddedItemKey\n        ? protectedStates.filter((state) => addedItemKey(state) === winnerAddedItemKey).length\n        : 0,\n      WINNER_ADDED_ITEM_OBJECTIVE_GAIN_RANK: oneBasedRank(winnerAddedByObjective, traceChildKey),\n      WINNER_ADDED_ITEM_PROXY_GAIN_RANK: oneBasedRank(winnerAddedByProxy, traceChildKey),\n      WINNER_ADDED_ITEM_DISTINCT_PARENT_COUNT: winnerAddedItemDistinctParents.size,\n      PROTECTED_DISTINCT_PARENT_COUNT: protectedParentKeys.size,\n      PROTECTED_DISTINCT_ADDED_ITEM_COUNT: distinctAddedItemCount(protectedStates),\n      RESERVE_LIMIT: reserveLimit,\n      CAN_COVER_EVERY_ADDED_ITEM_WITH_ONE_RESERVE_SLOT: distinctAddedItemCount(marginalPool) <= reserveLimit,\n      CAN_COVER_EVERY_UNREPRESENTED_PARENT_WITH_ONE_RESERVE_SLOT: unrepresentedParentKeys.size <= reserveLimit\n    });\n  }\n\n  let output;`
  );
  writeFileSync(tempPath, instrumented, 'utf8');

  try {
    const { buildGroupChoices } = await import(`${pathToFileURL(tempPath).href}?trace=${Date.now()}`);
    const dataset = JSON.parse(readFileSync(new URL('../data/normalized/dofus-data.json', import.meta.url), 'utf8'));
    const spellData = JSON.parse(readFileSync(new URL('../data/normalized/spell-data.json', import.meta.url), 'utf8'));
    const iop = (spellData.breeds || []).find((breed) => breed?.name === 'Iop');
    assert.ok(iop, 'Iop breed must exist');

    const request = createOptimizerV2Request({
      dataset,
      spellData,
      classId: String(iop.id),
      element: 'fire',
      constraints: { ap: 12, mp: 6, initiative: 0 },
      turnMode: 't1',
      topN: 10
    });
    const selections = (request.classSpells || []).map((spell) => ({
      spell: { ...spell },
      enabled: true,
      weight: 1,
      casts: { 1: 1, 2: 0, 3: 0 }
    }));
    const scenario = { ...(request.scenario || {}) };
    const prefiltered = prefilterItems({
      items: request.items,
      sets: request.sets,
      selections,
      constraints: request.constraints,
      turnMode: 't1',
      scenario,
      searchProfile: request.searchProfile
    });
    const byName = new Map(request.items.map((entry) => [entry.name, entry]));
    const winnerItems = WINNER_NAMES.map((name) => byName.get(name));
    const missingNames = WINNER_NAMES.filter((_, index) => !winnerItems[index]);
    assert.deepEqual(missingNames, [], `certified winner items missing from dataset: ${missingNames.join(', ')}`);
    const winnerIds = winnerItems.map((entry) => String(entry.id));
    const winnerIdSet = new Set(winnerIds);

    const dofusProfiles = prefiltered.pools.dofus
      .map((entry) => prefiltered.policy.profileItem(entry))
      .sort((a, b) => b.rankScore - a.rankScore || String(a.item.id).localeCompare(String(b.item.id)));
    const orderedWinnerIds = dofusProfiles
      .filter((profile) => winnerIdSet.has(String(profile.item.id)))
      .map((profile) => String(profile.item.id));
    assert.equal(orderedWinnerIds.length, WINNER_NAMES.length, 'winner path must contain six ordered profiles');

    const winnerParentKey = key(orderedWinnerIds.slice(0, 3));
    const winnerChildKey = key(orderedWinnerIds.slice(0, 4));
    let structuralTrace = null;
    buildGroupChoices(dofusProfiles, 6, {
      policy: prefiltered.policy,
      profile: prefiltered.policy.profile,
      constraints: request.constraints,
      turnMode: 't1',
      scenario,
      slot: 'dofus',
      traceParentKey: winnerParentKey,
      traceChildKey: winnerChildKey,
      onDofusStructuralTrace(trace) {
        structuralTrace = trace;
      }
    });

    assert.ok(structuralTrace, 'beam4 structural trace must be captured');
    const traceFields = [
      'MARGINAL_POOL_DISTINCT_PARENT_COUNT',
      'MARGINAL_POOL_DISTINCT_ADDED_ITEM_COUNT',
      'PRIMARY_BEAM4_DISTINCT_PARENT_COUNT',
      'PRIMARY_BEAM4_DISTINCT_ADDED_ITEM_COUNT',
      'UNREPRESENTED_PARENT_COUNT',
      'WINNER_ADDED_ITEM_KEY',
      'WINNER_ADDED_ITEM_POOL_COUNT',
      'WINNER_ADDED_ITEM_PRIMARY_COUNT',
      'WINNER_ADDED_ITEM_PROTECTED_COUNT',
      'WINNER_ADDED_ITEM_OBJECTIVE_GAIN_RANK',
      'WINNER_ADDED_ITEM_PROXY_GAIN_RANK',
      'WINNER_ADDED_ITEM_DISTINCT_PARENT_COUNT',
      'PROTECTED_DISTINCT_PARENT_COUNT',
      'PROTECTED_DISTINCT_ADDED_ITEM_COUNT',
      'RESERVE_LIMIT',
      'CAN_COVER_EVERY_ADDED_ITEM_WITH_ONE_RESERVE_SLOT',
      'CAN_COVER_EVERY_UNREPRESENTED_PARENT_WITH_ONE_RESERVE_SLOT'
    ];
    for (const field of traceFields) {
      const value = structuralTrace[field];
      console.log(`${field}=${value === null || value === undefined ? 'NULL' : String(value)}`);
    }
    console.log(`T1_BEAM4_STRUCTURAL_TRACE=${JSON.stringify(structuralTrace)}`);
  } finally {
    try { unlinkSync(tempPath); } catch {}
  }
});
