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
  'Major Scholar',
  'Major Fire Wrecker'
];

function key(ids = []) {
  return ids.map(String).sort().join('|');
}

test('diagnostic: trace certified T1 local winner through Dofus multipick beams', async () => {
  const sourcePath = fileURLToPath(new URL('../optimizer/candidate-search.js', import.meta.url));
  const tempPath = fileURLToPath(new URL(`../optimizer/.candidate-search-trace-${process.pid}-${Date.now()}.mjs`, import.meta.url));
  const source = readFileSync(sourcePath, 'utf8');
  const needle = '    states = keepChoiceDiversity(next, beamWidth, context);\n    if (!states.length) break;';
  assert.equal(source.includes(needle), true, 'candidate-search beam reduction shape changed');
  const instrumented = source.replace(
    needle,
    `    states = keepChoiceDiversity(next, beamWidth, context);\n    if (typeof context.onGroupChoiceBeam === 'function') {\n      context.onGroupChoiceBeam({\n        pick: pick + 1,\n        candidateKeys: states.map((state) => choiceKey(state.items))\n      });\n    }\n    if (!states.length) break;`
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
    const missingFromPool = winnerItems
      .filter((entry) => !dofusProfiles.some((profile) => String(profile.item.id) === String(entry.id)))
      .map((entry) => entry.name);
    assert.deepEqual(missingFromPool, [], `certified winner items missing from Dofus pool: ${missingFromPool.join(', ')}`);

    const orderedWinnerIds = dofusProfiles
      .filter((profile) => winnerIdSet.has(String(profile.item.id)))
      .map((profile) => String(profile.item.id));
    assert.equal(orderedWinnerIds.length, WINNER_NAMES.length, 'winner path must contain six ordered profiles');

    const beamTrace = [];
    let finalTrace = null;
    const choices = buildGroupChoices(dofusProfiles, 6, {
      policy: prefiltered.policy,
      profile: prefiltered.policy.profile,
      constraints: request.constraints,
      turnMode: 't1',
      scenario,
      slot: 'dofus',
      onGroupChoiceBeam({ pick, candidateKeys }) {
        const prefixKey = key(orderedWinnerIds.slice(0, pick));
        beamTrace.push({
          pick,
          winnerPathPresent: candidateKeys.includes(prefixKey),
          retainedCount: candidateKeys.length
        });
      },
      onGroupChoiceFinalReduction(trace) {
        finalTrace = trace;
      }
    });
    assert.ok(finalTrace, 'final reduction trace must be captured');

    const report = {
      winnerPresentAfterEachMultipickBeam: beamTrace,
      winnerPresentInFinalStates: finalTrace.candidateKeys.includes(winnerKey),
      winnerPresentInPrimaryFinalReduction: finalTrace.primaryKeys.includes(winnerKey),
      winnerPresentAfterFix: finalTrace.retainedKeys.includes(winnerKey),
      dofusChoicesBefore: finalTrace.primaryKeys.length,
      dofusChoicesAfter: finalTrace.retainedKeys.length,
      returnedChoices: choices.length,
      winnerKey
    };
    console.log(`T1_LOCAL_QUALITY_TRACE=${JSON.stringify(report)}`);
  } finally {
    try { unlinkSync(tempPath); } catch {}
  }
});
