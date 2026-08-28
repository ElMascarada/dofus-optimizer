import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { prefilterItems } from '../js/candidate-prefilter.js';
import { preferCompanionVitalityOnTies } from '../js/combat-feedback.js';
import { searchArchitecturesV2 } from '../js/architecture-search-v2.js';
import { createOptimizerV2Request } from '../js/optimizer-v2-orchestrator.js';
import { buildGroupChoices } from '../optimizer/candidate-search.js';
import { getSearchProfile } from '../optimizer/search-profiles.js';

const IGNORED_COMPLEX_DOFUS_PASSIVES = [
  'deep-purple',
  'turquoise-blue',
  'vermilion-red',
  'yellow-ochre',
  'descent-to-abyss'
];

const dataset = JSON.parse(readFileSync(new URL('../data/normalized/dofus-data.json', import.meta.url), 'utf8'));
const spellData = JSON.parse(readFileSync(new URL('../data/normalized/spell-data.json', import.meta.url), 'utf8'));
const iop = (spellData.breeds || []).find((breed) => breed?.name === 'Iop');
assert.ok(iop);

function payload() {
  const request = createOptimizerV2Request({
    dataset,
    spellData,
    classId: String(iop.id),
    element: 'earth',
    constraints: { ap: 12, mp: 6, initiative: 0 },
    turnMode: 't1',
    topN: 10
  });
  const objective = request.combatObjective || {};
  const selections = (request.classSpells || [])
    .filter((spell) => (spell?.hits || []).some((hit) => hit?.element === (objective.element || 'earth')))
    .map((spell) => ({ spell: { ...spell }, enabled: true, weight: 1, casts: { 1: 1, 2: 0, 3: 0 } }));
  return {
    ...request,
    searchProfile: String(request.searchProfile || 'BALANCED').toUpperCase(),
    requiredItemIds: [...new Set((request.requiredItemIds || []).map(String).filter(Boolean))],
    items: preferCompanionVitalityOnTies(request.items || []),
    selections,
    turnMode: 't1',
    scenario: {
      ...(request.scenario || {}),
      requiredApByTurn: {},
      ignoredPassiveIds: [...new Set([...(request.scenario?.ignoredPassiveIds || []), ...IGNORED_COMPLEX_DOFUS_PASSIVES])]
    },
    fmPolicy: { ...request.fmPolicy, structuralExos: false },
    topN: 90
  };
}

function key(items = []) {
  return items.map((item) => String(item.id)).sort().join('|');
}

function isSubset(items = [], targetIds = new Set()) {
  return items.every((item) => targetIds.has(String(item.id)));
}

test('temporary Dofus group retention diagnostic', (t) => {
  const p = payload();
  const fallback = searchArchitecturesV2({ ...p, items: p.items.filter((item) => !item.conditions) });
  const target = (fallback.results?.[0]?.items || []).filter((item) => item.slot === 'dofus');
  assert.equal(target.length, 6, 'fallback target must expose six Dofus/trophies');
  const targetIds = new Set(target.map((item) => String(item.id)));

  const profile = getSearchProfile(p.searchProfile);
  const prefilter = prefilterItems({
    items: p.items,
    sets: p.sets,
    selections: p.selections,
    constraints: p.constraints,
    turnMode: p.turnMode,
    scenario: p.scenario,
    requiredItemIds: p.requiredItemIds,
    searchProfile: profile
  });
  const profiles = (prefilter.pools?.dofus || [])
    .map((item) => prefilter.policy.profileItem(item))
    .sort((a, b) => b.rankScore - a.rankScore || String(a.item.id).localeCompare(String(b.item.id)));
  const setsById = Object.fromEntries((p.sets || []).map((set) => [set.id, set]));
  const context = {
    policy: prefilter.policy,
    profile,
    selections: p.selections,
    constraints: p.constraints,
    turnMode: p.turnMode,
    scenario: p.scenario,
    sets: p.sets,
    setsById,
    slot: 'dofus'
  };

  const targetProfiles = profiles
    .filter((entry) => targetIds.has(String(entry.item.id)))
    .map((entry) => ({
      id: String(entry.item.id),
      name: entry.item.name,
      rankIndex: profiles.indexOf(entry),
      rankScore: entry.rankScore,
      objectiveGain: entry.objectiveGain,
      stats: entry.optimisticStats,
      conditions: entry.item.conditions || null
    }));

  const pickDiagnostics = [];
  for (let count = 2; count <= 6; count++) {
    const choices = buildGroupChoices(profiles, count, context);
    const targetSubsets = choices.filter((choice) => isSubset(choice.items, targetIds));
    const maxOverlap = choices.reduce((best, choice) => Math.max(
      best,
      choice.items.filter((item) => targetIds.has(String(item.id))).length
    ), 0);
    const overlapLeaders = choices
      .map((choice) => ({
        ids: choice.items.map((item) => String(item.id)),
        overlap: choice.items.filter((item) => targetIds.has(String(item.id))).length,
        score: choice.score,
        objectiveScore: choice.objectiveScore,
        stats: choice.optimisticStats
      }))
      .sort((a, b) => b.overlap - a.overlap || b.score - a.score)
      .slice(0, 8);
    pickDiagnostics.push({
      count,
      choices: choices.length,
      targetSubsetCount: targetSubsets.length,
      maxOverlap,
      overlapLeaders
    });
  }

  const finalChoices = buildGroupChoices(profiles, 6, context);
  const conditionless = finalChoices.filter((choice) => choice.items.every((item) => !item.conditions));
  t.diagnostic(`DOFUS_DEBUG ${JSON.stringify({
    fallbackScore: Number(fallback.results?.[0]?.score || 0),
    targetKey: key(target),
    targetProfiles,
    profileCount: profiles.length,
    conditionlessProfileCount: profiles.filter((entry) => !entry.item.conditions).length,
    finalChoices: finalChoices.length,
    finalConditionless: conditionless.length,
    exactTarget: finalChoices.some((choice) => key(choice.items) === key(target)),
    pickDiagnostics
  })}`);
});
