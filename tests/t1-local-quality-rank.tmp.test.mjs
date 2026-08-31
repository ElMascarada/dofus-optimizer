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

function key(ids = []) { return ids.map(String).sort().join('|'); }

test('diagnostic: rank certified winner at first lossy Dofus beam', async () => {
  const sourcePath = fileURLToPath(new URL('../optimizer/candidate-search.js', import.meta.url));
  const tempPath = fileURLToPath(new URL(`../optimizer/.candidate-search-rank-${process.pid}-${Date.now()}.mjs`, import.meta.url));
  const source = readFileSync(sourcePath, 'utf8');
  const needle = `    const primaryStates = keepChoiceDiversity(next, beamWidth, context);`;
  assert.equal(source.includes(needle), true);
  const instrumented = source.replace(needle, `    if (typeof context.onGroupChoicePreReduction === 'function') {\n      context.onGroupChoicePreReduction({ pick: pick + 1, states: next.map((state) => ({ key: choiceKey(state.items), score: state.score, objectiveScore: state.objectiveScore })) });\n    }\n${needle}`);
  writeFileSync(tempPath, instrumented, 'utf8');

  try {
    const { buildGroupChoices } = await import(`${pathToFileURL(tempPath).href}?trace=${Date.now()}`);
    const dataset = JSON.parse(readFileSync(new URL('../data/normalized/dofus-data.json', import.meta.url), 'utf8'));
    const spellData = JSON.parse(readFileSync(new URL('../data/normalized/spell-data.json', import.meta.url), 'utf8'));
    const iop = (spellData.breeds || []).find((breed) => breed?.name === 'Iop');
    assert.ok(iop);
    const request = createOptimizerV2Request({ dataset, spellData, classId: String(iop.id), element: 'fire', constraints: { ap: 12, mp: 6, initiative: 0 }, turnMode: 't1', topN: 10 });
    const selections = (request.classSpells || []).map((spell) => ({ spell: { ...spell }, enabled: true, weight: 1, casts: { 1: 1, 2: 0, 3: 0 } }));
    const scenario = { ...(request.scenario || {}) };
    const prefiltered = prefilterItems({ items: request.items, sets: request.sets, selections, constraints: request.constraints, turnMode: 't1', scenario, searchProfile: request.searchProfile });
    const byName = new Map(request.items.map((entry) => [entry.name, entry]));
    const winnerItems = WINNER_NAMES.map((name) => byName.get(name));
    assert.equal(winnerItems.every(Boolean), true);
    const winnerIdSet = new Set(winnerItems.map((entry) => String(entry.id)));
    const profiles = prefiltered.pools.dofus.map((entry) => prefiltered.policy.profileItem(entry)).sort((a, b) => b.rankScore - a.rankScore || String(a.item.id).localeCompare(String(b.item.id)));
    const orderedWinnerIds = profiles.filter((profile) => winnerIdSet.has(String(profile.item.id))).map((profile) => String(profile.item.id));
    assert.equal(orderedWinnerIds.length, 6);
    const target4 = key(orderedWinnerIds.slice(0, 4));
    const parent3 = key(orderedWinnerIds.slice(0, 3));
    let report = null;

    buildGroupChoices(profiles, 6, {
      policy: prefiltered.policy, profile: prefiltered.policy.profile, constraints: request.constraints, turnMode: 't1', scenario, slot: 'dofus',
      onGroupChoicePreReduction({ pick, states }) {
        if (pick !== 4) return;
        const byObjective = [...states].sort((a, b) => b.objectiveScore - a.objectiveScore || b.score - a.score || a.key.localeCompare(b.key));
        const byProxy = [...states].sort((a, b) => b.score - a.score || b.objectiveScore - a.objectiveScore || a.key.localeCompare(b.key));
        const target = states.find((state) => state.key === target4);
        assert.ok(target, 'winner prefix must exist before beam-4 reduction');
        const siblings = states.filter((state) => state.key.split('|').filter((id) => parent3.split('|').includes(id)).length === 3);
        const siblingObjective = [...siblings].sort((a, b) => b.objectiveScore - a.objectiveScore || b.score - a.score || a.key.localeCompare(b.key));
        const siblingProxy = [...siblings].sort((a, b) => b.score - a.score || b.objectiveScore - a.objectiveScore || a.key.localeCompare(b.key));
        report = {
          candidateCount: states.length,
          targetObjectiveRank: byObjective.findIndex((state) => state.key === target4) + 1,
          targetProxyRank: byProxy.findIndex((state) => state.key === target4) + 1,
          siblingCount: siblings.length,
          targetSiblingObjectiveRank: siblingObjective.findIndex((state) => state.key === target4) + 1,
          targetSiblingProxyRank: siblingProxy.findIndex((state) => state.key === target4) + 1,
          topSiblingObjectiveKeys: siblingObjective.slice(0, 8).map((state) => state.key),
          target4,
          parent3
        };
      }
    });
    assert.ok(report);
    console.log(`T1_LOCAL_QUALITY_RANK=${JSON.stringify(report)}`);
  } finally {
    try { unlinkSync(tempPath); } catch {}
  }
});
