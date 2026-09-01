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

test('diagnostic: trace certified T1 local winner through Dofus multipick beams after fix', async () => {
  const sourcePath = fileURLToPath(new URL('../optimizer/candidate-search.js', import.meta.url));
  const tempPath = fileURLToPath(new URL(`../optimizer/.candidate-search-trace-${process.pid}-${Date.now()}.mjs`, import.meta.url));
  const source = readFileSync(sourcePath, 'utf8');
  const beamNeedle = `    if (!states.length) break;`;
  assert.equal(source.includes(beamNeedle), true, 'candidate-search beam reduction shape changed');
  const instrumentedBeam = source.replace(
    beamNeedle,
    `    if (typeof context.onGroupChoiceBeam === 'function') {\n      context.onGroupChoiceBeam({\n        pick: pick + 1,\n        candidateKeys: states.map((state) => choiceKey(state.items))\n      });\n    }\n    if (!states.length) break;`
  );
  const marginalTraceNeedle = `    context.onDofusParentChildTrace({\n      WINNER_PARENT_RETAINED_INDEX_AT_PICK3: oneBasedStateIndex(parentStates, traceParentKey),`;
  assert.equal(instrumentedBeam.includes(marginalTraceNeedle), true, 'candidate-search marginal reserve trace shape changed');
  const instrumentedMarginal = instrumentedBeam.replace(
    marginalTraceNeedle,
    `    const winnerMarginalState = marginalPool.find((state) => choiceKey(state.items) === traceChildKey) || null;\n    const winnerMarginalByObjective = [...marginalPool].sort((a, b) => b.objectiveScore - a.objectiveScore\n      || b.score - a.score\n      || choiceKey(a.items).localeCompare(choiceKey(b.items)));\n    const winnerMarginalByProxy = [...marginalPool].sort((a, b) => b.score - a.score\n      || b.objectiveScore - a.objectiveScore\n      || choiceKey(a.items).localeCompare(choiceKey(b.items)));\n    const marginalDiversified = keepChoiceDiversity(\n      marginalPool,\n      Math.min(marginalPool.length, reserveLimit),\n      context,\n      { preserveStructuralContributors: true }\n    );\n    const protectedParentCounts = new Map();\n    for (const state of protectedStates) {\n      const parentKey = parentChoiceKey(state);\n      protectedParentCounts.set(parentKey, (protectedParentCounts.get(parentKey) || 0) + 1);\n    }\n    const protectedAddedItemIds = new Set(protectedStates\n      .map((state) => {\n        const items = state.items || [];\n        return items.length ? String(items[items.length - 1]?.id || '') : '';\n      })\n      .filter(Boolean));\n    const marginalDiversifiedIndex = oneBasedStateIndex(marginalDiversified, traceChildKey);\n    const winnerMarginalObjectiveRank = oneBasedStateIndex(winnerMarginalByObjective, traceChildKey);\n    const winnerMarginalProxyRank = oneBasedStateIndex(winnerMarginalByProxy, traceChildKey);\n    const maxProtectedChildrenFromOneParent = protectedParentCounts.size\n      ? Math.max(...protectedParentCounts.values())\n      : 0;\n\n    context.onDofusParentChildTrace({\n      MARGINAL_POOL_COUNT: marginalPool.length,\n      WINNER_MARGINAL_OBJECTIVE_GAIN: winnerMarginalState?.objectiveScore ?? null,\n      WINNER_MARGINAL_PROXY_GAIN: winnerMarginalState?.score ?? null,\n      WINNER_MARGINAL_OBJECTIVE_RANK: winnerMarginalObjectiveRank,\n      WINNER_MARGINAL_PROXY_RANK: winnerMarginalProxyRank,\n      WINNER_PARENT_REPRESENTATIVE_COUNT: winnerRepresentatives.length,\n      WINNER_PRESENT_IN_MARGINAL_POOL: winnerMarginalState !== null,\n      WINNER_PRESENT_IN_MARGINAL_DIVERSIFIED: marginalDiversifiedIndex !== null,\n      WINNER_MARGINAL_DIVERSIFIED_INDEX: marginalDiversifiedIndex,\n      PROTECTED_STATE_COUNT: protectedStates.length,\n      PROTECTED_DISTINCT_PARENT_COUNT: protectedParentCounts.size,\n      WINNER_PARENT_PROTECTED_CHILD_COUNT: protectedParentCounts.get(traceParentKey) || 0,\n      MAX_PROTECTED_CHILDREN_FROM_ONE_PARENT: maxProtectedChildrenFromOneParent,\n      PROTECTED_DISTINCT_ADDED_ITEM_COUNT: protectedAddedItemIds.size,\n      WINNER_PARENT_RETAINED_INDEX_AT_PICK3: oneBasedStateIndex(parentStates, traceParentKey),`
  );
  const finalNeedle = `  return keepChoiceDiversity(states, diversityLimit, context, { preserveStructuralContributors: true })\n    .map(({ items, score, objectiveScore, optimisticStats, bounded, prysma }) => ({\n      items, score, objectiveScore, optimisticStats, bounded, prysma\n    }));`;
  assert.equal(instrumentedMarginal.includes(finalNeedle), true, 'candidate-search final reduction shape changed');
  const instrumented = instrumentedMarginal.replace(
    finalNeedle,
    `  const tracedFinalChoices = keepChoiceDiversity(states, diversityLimit, context, { preserveStructuralContributors: true });\n  if (typeof context.onGroupChoiceFinalReduction === 'function') {\n    context.onGroupChoiceFinalReduction({\n      candidateKeys: states.map((state) => choiceKey(state.items)),\n      primaryKeys: tracedFinalChoices.map((state) => choiceKey(state.items))\n    });\n  }\n  return tracedFinalChoices.map(({ items, score, objectiveScore, optimisticStats, bounded, prysma }) => ({\n    items, score, objectiveScore, optimisticStats, bounded, prysma\n  }));`
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
    const winnerKey = key(winnerIds);

    const dofusProfiles = prefiltered.pools.dofus
      .map((entry) => prefiltered.policy.profileItem(entry))
      .sort((a, b) => b.rankScore - a.rankScore || String(a.item.id).localeCompare(String(b.item.id)));
    const orderedWinnerIds = dofusProfiles
      .filter((profile) => winnerIdSet.has(String(profile.item.id)))
      .map((profile) => String(profile.item.id));
    assert.equal(orderedWinnerIds.length, WINNER_NAMES.length, 'winner path must contain six ordered profiles');

    const winnerParentKey = key(orderedWinnerIds.slice(0, 3));
    const winnerChildKey = key(orderedWinnerIds.slice(0, 4));
    const beamTrace = [];
    let parentChildTrace = null;
    let finalTrace = null;
    const choices = buildGroupChoices(dofusProfiles, 6, {
      policy: prefiltered.policy,
      profile: prefiltered.policy.profile,
      constraints: request.constraints,
      turnMode: 't1',
      scenario,
      slot: 'dofus',
      traceParentKey: winnerParentKey,
      traceChildKey: winnerChildKey,
      onDofusParentChildTrace(trace) {
        parentChildTrace = trace;
      },
      onGroupChoiceBeam({ pick, candidateKeys }) {
        const prefixKey = key(orderedWinnerIds.slice(0, pick));
        beamTrace.push({ pick, winnerPathPresent: candidateKeys.includes(prefixKey), retainedCount: candidateKeys.length });
      },
      onGroupChoiceFinalReduction(trace) {
        finalTrace = trace;
      }
    });

    const configuredDofusGroupBeamWidth = Number(prefiltered.policy.profile.search.dofusGroupBeamWidth);
    const beam3 = beamTrace.find((entry) => entry.pick === 3);
    const beam4 = beamTrace.find((entry) => entry.pick === 4);
    const diagnosticTrace = {
      ...(parentChildTrace || {}),
      BEAM4_RETAINED_COUNT: beam4?.retainedCount ?? parentChildTrace?.BEAM4_RETAINED_COUNT ?? null,
      CONFIGURED_DOFUS_GROUP_BEAM_WIDTH: configuredDofusGroupBeamWidth
    };
    const traceFields = [
      'MARGINAL_POOL_COUNT',
      'WINNER_MARGINAL_OBJECTIVE_GAIN',
      'WINNER_MARGINAL_PROXY_GAIN',
      'WINNER_MARGINAL_OBJECTIVE_RANK',
      'WINNER_MARGINAL_PROXY_RANK',
      'WINNER_PARENT_REPRESENTATIVE_COUNT',
      'WINNER_PRESENT_IN_MARGINAL_POOL',
      'WINNER_PRESENT_IN_MARGINAL_DIVERSIFIED',
      'WINNER_MARGINAL_DIVERSIFIED_INDEX',
      'PROTECTED_STATE_COUNT',
      'PROTECTED_DISTINCT_PARENT_COUNT',
      'WINNER_PARENT_PROTECTED_CHILD_COUNT',
      'MAX_PROTECTED_CHILDREN_FROM_ONE_PARENT',
      'PROTECTED_DISTINCT_ADDED_ITEM_COUNT',
      'WINNER_PARENT_RETAINED_INDEX_AT_PICK3',
      'PICK3_RETAINED_PARENT_COUNT',
      'WINNER_PARENT_HAS_ANY_PRIMARY_CHILD_AT_PICK4',
      'WINNER_PARENT_PRIMARY_CHILD_COUNT',
      'WINNER_PARENT_ORDER_IN_PARENT_LANES',
      'TOTAL_PARENT_LANES',
      'ACTIVE_PARENT_LANES',
      'RESERVE_LIMIT',
      'PER_LANE_LIMIT',
      'WINNER_PARENT_LANE_ACTIVE',
      'WINNER_SIBLING_COUNT',
      'WINNER_SIBLING_OBJECTIVE_RANK',
      'WINNER_SIBLING_PROXY_RANK',
      'WINNER_CHILD_PRESENT_IN_PARENT_CHILD_REPRESENTATIVES',
      'WINNER_CHILD_REPRESENTATIVE_INDEX',
      'WINNER_CHILD_ENTERED_PROTECTED_STATES',
      'WINNER_CHILD_PROTECTED_INDEX',
      'WINNER_CHILD_PRESENT_IN_PRIMARY_STATES',
      'WINNER_CHILD_PRESENT_IN_FINAL_BEAM4',
      'BEAM4_RETAINED_COUNT',
      'CONFIGURED_DOFUS_GROUP_BEAM_WIDTH'
    ];
    for (const field of traceFields) {
      const value = diagnosticTrace[field];
      console.log(`${field}=${value === null || value === undefined ? 'NULL' : String(value)}`);
    }
    console.log(`T1_PARENT_LANE_TRACE=${JSON.stringify(diagnosticTrace)}`);

    assert.ok(finalTrace, 'final reduction trace must be captured');
    assert.ok(Number.isFinite(configuredDofusGroupBeamWidth) && configuredDofusGroupBeamWidth > 0,
      'configured Dofus group beam width must be a positive finite number');
    assert.equal(beam3?.winnerPathPresent, true, 'certified winner parent must survive beam 3');
    assert.equal(beam4?.winnerPathPresent, true, 'certified winner child must survive beam 4 after fix');
    assert.ok((beam4?.retainedCount ?? Number.POSITIVE_INFINITY) <= configuredDofusGroupBeamWidth,
      `beam 4 retention must remain within configured Dofus beam width=${configuredDofusGroupBeamWidth}`);

    const report = {
      winnerPresentAfterEachMultipickBeam: beamTrace,
      winnerPresentInFinalStates: finalTrace.candidateKeys.includes(winnerKey),
      winnerPresentInPrimaryFinalReduction: finalTrace.primaryKeys.includes(winnerKey),
      winnerPresentAfterFix: choices.some((choice) => key(choice.items.map((item) => item.id)) === winnerKey),
      dofusChoicesBefore: finalTrace.primaryKeys.length,
      dofusChoicesAfter: choices.length,
      returnedChoices: choices.length,
      configuredDofusGroupBeamWidth,
      beam4RetainedCount: beam4?.retainedCount ?? null,
      winnerKey
    };
    console.log(`T1_LOCAL_QUALITY_TRACE=${JSON.stringify(report)}`);
  } finally {
    try { unlinkSync(tempPath); } catch {}
  }
});
