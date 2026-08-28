import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { prefilterItems } from '../js/candidate-prefilter.js';
import { createOptimizerV2Request } from '../js/optimizer-v2-orchestrator.js';
import { buildGroupChoices } from '../optimizer/candidate-search.js';

const earthSpell = {
  id: 'earth',
  hits: [{ element: 'earth', normal: [10, 10] }]
};
const earthSelections = [{ enabled: true, weight: 1, spell: earthSpell, casts: { 1: 1 } }];

function gear(id, stats, extra = {}) {
  return { id, slot: 'dofus', level: 200, stats, ...extra };
}

function ids(result) {
  return result.items.map((item) => item.id);
}

test('inactive Initiative does not reserve pure specialists but keeps independently useful items', () => {
  const fillers = Array.from({ length: 40 }, (_, index) => gear(`earth-${index}`, { earth: 200 - index }));
  const pureInitiative = gear('initiative-only', { initiative: 1000 });
  const offensiveInitiative = gear('initiative-power', { initiative: 1000, power: 90 });

  const result = prefilterItems({
    items: [...fillers, pureInitiative, offensiveInitiative],
    selections: earthSelections,
    constraints: { initiative: 0 },
    slotRules: [{ id: 'dofus', count: 6 }]
  });

  assert.ok(!ids(result).includes('initiative-only'));
  assert.ok(ids(result).includes('initiative-power'));
  assert.ok(!result.diagnostics.paretoDimensions.includes('initiative'));
  assert.equal(result.diagnostics.slots[0].specialists.initiative, undefined);
});

test('a positive Initiative constraint restores Initiative specialist protection', () => {
  const fillers = Array.from({ length: 40 }, (_, index) => gear(`earth-${index}`, { earth: 200 - index }));
  const pureInitiative = gear('initiative-only', { initiative: 1000 });

  const result = prefilterItems({
    items: [...fillers, pureInitiative],
    selections: earthSelections,
    constraints: { initiative: 1000 },
    slotRules: [{ id: 'dofus', count: 6 }]
  });

  assert.ok(ids(result).includes('initiative-only'));
  assert.ok(result.diagnostics.paretoDimensions.includes('initiative'));
  assert.ok(Number(result.diagnostics.slots[0].specialists.initiative || 0) > 0);
});

function syntheticProfile(item, objectiveGain = 0) {
  return {
    item,
    optimisticStats: Object.fromEntries(Object.entries(item.stats || {}).filter(([, value]) => Number(value) > 0)),
    bounded: true,
    rankScore: objectiveGain * 1000 + Math.max(0, Number(item.stats?.initiative || 0)) * 1000,
    objectiveGain
  };
}

test('Candidate Search retains true Initiative instead of a +1000/-1000 false specialist', () => {
  const initiative = gear('initiative-anchor', { initiative: 1000 });
  const penaltyOffense = gear('surpryz-like', { initiative: -1000, earth: 1000 });
  const neutral = gear('neutral', {});
  const profiles = [
    syntheticProfile(initiative),
    syntheticProfile(penaltyOffense, 1000),
    syntheticProfile(neutral)
  ];
  const constraints = { initiative: 1000 };
  const profile = {
    ranking: { constraintWeight: 1000000 },
    search: {
      dofusGroupBeamWidth: 2,
      multiPickBeamWidth: 2,
      groupBeamWidth: 2,
      groupBucketLimit: 1,
      groupDiversityMultiplier: 1,
      groupSpecialistReservePerStat: 1,
      groupOffenseReserve: 0,
      groupChoiceLimits: { dofus: 1 }
    }
  };
  const policy = {
    paretoKeys: ['initiative'],
    rankStats(stats = {}) {
      const initiativeSignal = Math.min(1, Math.max(0, Number(stats.initiative || 0)) / 1000);
      const objectiveGain = Math.max(0, Number(stats.earth || 0));
      return {
        objectiveGain,
        constraintSignal: initiativeSignal,
        rankScore: objectiveGain * 1000 + initiativeSignal * profile.ranking.constraintWeight
      };
    }
  };

  const choices = buildGroupChoices(profiles, 2, {
    slot: 'dofus',
    constraints,
    policy,
    profile
  });

  assert.equal(choices.length, 1);
  assert.deepEqual(choices[0].items.map((item) => item.id), ['initiative-anchor', 'neutral']);
  assert.equal(choices[0].items.reduce((sum, item) => sum + Number(item.stats?.initiative || 0), 0), 1000);
  assert.ok(!choices[0].items.some((item) => item.id === 'surpryz-like'));
});

const dataset = JSON.parse(readFileSync(new URL('../data/normalized/dofus-data.json', import.meta.url), 'utf8'));
const spellData = JSON.parse(readFileSync(new URL('../data/normalized/spell-data.json', import.meta.url), 'utf8'));
const iop = (spellData.breeds || []).find((breed) => breed?.name === 'Iop');
assert.ok(iop, 'Iop must exist in canonical spell data');

let workerHandler = null;
let activeMessages = null;
globalThis.self = {
  addEventListener(type, handler) {
    if (type === 'message') workerHandler = handler;
  },
  postMessage(message) {
    activeMessages?.push(message);
  }
};
await import(`../js/optimizer-worker.js?initiative-coherence=${Date.now()}`);

function runRealWorker(payload) {
  activeMessages = [];
  workerHandler({ data: { type: 'optimize', requestId: 1, payload } });
  const messages = [...activeMessages];
  const resultMessage = messages.findLast((message) => message?.type === 'result');
  const errorMessage = messages.findLast((message) => message?.type === 'error');
  activeMessages = null;
  if (!resultMessage) throw new Error(errorMessage?.message || 'Initiative coherence regression: no Worker result');
  return { output: resultMessage.output, messages };
}

function iopEarthRequest(initiative) {
  return createOptimizerV2Request({
    dataset,
    spellData,
    classId: String(iop.id),
    element: 'earth',
    constraints: { ap: 12, mp: 6, initiative },
    turnMode: 't1',
    topN: 10
  });
}

function workerGearSelections(request) {
  return (request.classSpells || [])
    .filter((spell) => (spell.hits || []).some((hit) => hit?.element === 'earth'))
    .map((spell) => ({
      spell: { ...spell },
      enabled: true,
      weight: 1,
      casts: { 1: 1, 2: 0, 3: 0 }
    }));
}

function initiativePoolSummary(candidatePools = {}) {
  return Object.fromEntries(Object.entries(candidatePools || {}).map(([slot, items]) => {
    const values = (items || []).map((item) => Number(item?.stats?.initiative || 0));
    return [slot, {
      count: (items || []).length,
      positive: values.filter((value) => value > 0).length,
      max: values.length ? Math.max(...values) : 0
    }];
  }));
}

test('canonical constrained Dofus group choices retain net Initiative specialists', (t) => {
  const request = iopEarthRequest(1000);
  const selections = workerGearSelections(request);
  const scenario = {
    ...(request.scenario || {}),
    requiredApByTurn: {},
    ignoredPassiveIds: ['deep-purple', 'turquoise-blue', 'vermilion-red', 'yellow-ochre', 'descent-to-abyss']
  };
  const prefilter = prefilterItems({
    items: request.items,
    sets: request.sets,
    selections,
    constraints: request.constraints,
    turnMode: request.turnMode,
    scenario,
    searchProfile: request.searchProfile
  });
  const profiles = (prefilter.pools?.dofus || [])
    .map((item) => prefilter.policy.profileItem(item))
    .sort((a, b) => b.rankScore - a.rankScore || String(a.item.id).localeCompare(String(b.item.id)));
  const choices = buildGroupChoices(profiles, 6, {
    policy: prefilter.policy,
    profile: prefilter.policy.profile,
    selections,
    constraints: request.constraints,
    turnMode: request.turnMode,
    scenario,
    sets: request.sets,
    slot: 'dofus'
  });
  const summaries = choices.map((choice) => ({
    initiative: choice.items.reduce((sum, item) => sum + Number(item.stats?.initiative || 0), 0),
    names: choice.items.map((item) => item.name)
  })).sort((a, b) => b.initiative - a.initiative);
  t.diagnostic(`INITIATIVE_DOFUS_CHOICES ${JSON.stringify({
    count: choices.length,
    atLeast1000: summaries.filter((entry) => entry.initiative >= 1000).length,
    max: summaries[0]?.initiative || 0,
    top: summaries.slice(0, 5)
  })}`);
  assert.ok(summaries.some((entry) => entry.initiative >= 1000), 'Candidate Search must retain at least one Dofus group with net Initiative >= 1000');
});

test('Iop Terre T1 12/6 with inactive Initiative no longer returns pure Initiative trophies', (t) => {
  const { output } = runRealWorker(iopEarthRequest(0));
  const results = output?.results || [];
  assert.ok(results.length > 0, 'the certified Worker scenario must still produce results');

  for (const build of results) {
    const names = new Set((build.items || []).map((item) => item?.name));
    assert.ok(!names.has('Initiateur'), 'Initiateur must not survive solely for inactive Initiative');
    assert.ok(!names.has('Initiateur mineur'), 'Initiateur mineur must not survive solely for inactive Initiative');
  }

  const best = results[0];
  assert.ok(Number(best.score || 0) >= 4285.1832 - 1e-6, 'the targeted coherence fix must not lower the certified combat score floor');
  t.diagnostic(`INITIATIVE_COHERENCE_RESULT ${JSON.stringify({
    score: best.score,
    initiative: best.stats?.initiative,
    items: (best.items || []).map((item) => item.name)
  })}`);
});

test('Iop Terre T1 12/6 with Initiative 1000 produces a valid Worker build', (t) => {
  const { output, messages } = runRealWorker(iopEarthRequest(1000));
  const results = output?.results || [];
  const progress = messages.filter((message) => message?.type === 'progress').map((message) => message.progress);
  t.diagnostic(`INITIATIVE_1000_DIAGNOSTIC ${JSON.stringify({
    results: results.length,
    diagnostics: output?.diagnostics,
    candidatePools: initiativePoolSummary(output?.candidatePools),
    lastProgress: progress.at(-1)
  })}`);

  assert.ok(results.length > 0, 'the canonical Worker scenario with Initiative 1000 must produce results');
  for (const build of results) {
    assert.ok(Number(build.stats?.initiative || 0) >= 1000, 'every returned Worker build must satisfy Initiative >= 1000');
  }
});
