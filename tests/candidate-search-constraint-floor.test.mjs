import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createOptimizerV2Request } from '../js/optimizer-v2-orchestrator.js';
import { prefilterItems } from '../js/candidate-prefilter.js';
import {
  buildGroupChoices,
  signedConstraintOrderingSignal
} from '../optimizer/candidate-search.js';

const constraints = { ap: 12, mp: 5 };

test('signed constraint ordering saturates PA/PM at their admissibility floors', () => {
  const atFloor = signedConstraintOrderingSignal({ ap: 12, mp: 5 }, constraints);

  assert.equal(signedConstraintOrderingSignal({ ap: 13, mp: 5 }, constraints), atFloor);
  assert.equal(signedConstraintOrderingSignal({ ap: 12, mp: 6 }, constraints), atFloor);
  assert.ok(signedConstraintOrderingSignal({ ap: 11, mp: 5 }, constraints) < atFloor);
  assert.ok(signedConstraintOrderingSignal({ ap: 12, mp: 4 }, constraints) < atFloor);
});

function item(id, stats = {}, { prysma = false } = {}) {
  return {
    id,
    name: id,
    level: 200,
    slot: 'dofus',
    setId: null,
    stats,
    passives: [],
    conditions: null,
    slotSubtype: prysma ? 'prysmaradite' : null,
    typeName: 'Dofus'
  };
}

function profileItem(entry) {
  return {
    item: entry,
    optimisticStats: Object.fromEntries(
      Object.entries(entry.stats || {}).filter(([, value]) => Number(value) > 0)
    ),
    bounded: true
  };
}

function generatorContext() {
  const generatorConstraints = { ap: 12, mp: 5 };
  const profile = {
    ranking: { constraintWeight: 1_000_000 },
    search: {
      dofusGroupBeamWidth: 10,
      multiPickBeamWidth: 10,
      groupBeamWidth: 10,
      groupBucketLimit: 1,
      groupDiversityMultiplier: 1,
      groupSpecialistReservePerStat: 1,
      groupOffenseReserve: 0,
      groupChoiceLimits: { dofus: 2 }
    }
  };
  const policy = {
    paretoKeys: ['ap', 'mp'],
    rankStats(stats = {}) {
      const objectiveGain = Math.max(0, Number(stats.earth || 0));
      const constraintSignal = Math.min(1, Math.max(0, Number(stats.ap || 0)) / 12)
        + Math.min(1, Math.max(0, Number(stats.mp || 0)) / 5);
      return {
        objectiveGain,
        constraintSignal,
        rankScore: objectiveGain * 1000 + constraintSignal * profile.ranking.constraintWeight
      };
    }
  };
  return { constraints: generatorConstraints, profile, policy, slot: 'dofus' };
}

test('Dofus group beam keeps an Ocre damage lane instead of preferring useless PA/PM surplus', () => {
  const profiles = [
    profileItem(item('ocre', { ap: 1 })),
    profileItem(item('damage', { ap: 3, mp: 1, earth: 200 }, { prysma: true })),
    profileItem(item('surplus-a', { ap: 5 }, { prysma: true })),
    profileItem(item('surplus-b', { ap: 4, mp: 2 }, { prysma: true })),
    profileItem(item('neutral', {}))
  ];

  const choices = buildGroupChoices(profiles, 2, generatorContext());
  const keys = choices.map((choice) => choice.items.map((entry) => entry.id).sort().join('|'));

  assert.ok(
    keys.includes('damage|ocre'),
    'meeting the floor with Ocre plus offense must not lose solely to PA/PM surplus'
  );
});

test('real Iop Earth T1 12/5 generator retains Ocre for cross-slot companion pairing', () => {
  const dataset = JSON.parse(readFileSync(new URL('../data/normalized/dofus-data.json', import.meta.url), 'utf8'));
  const spellData = JSON.parse(readFileSync(new URL('../data/normalized/spell-data.json', import.meta.url), 'utf8'));
  const iop = (spellData.breeds || []).find((breed) => breed?.name === 'Iop');
  assert.ok(iop, 'Iop breed must exist in normalized spell data');

  const request = createOptimizerV2Request({
    dataset,
    spellData,
    classId: String(iop.id),
    element: 'earth',
    constraints: { ap: 12, mp: 5, initiative: 0 },
    turnMode: 't1',
    topN: 10
  });
  const earthSpells = (request.classSpells || [])
    .filter((spell) => (spell?.hits || []).some((hit) => hit?.element === 'earth'));
  const selections = earthSpells.map((spell) => ({
    spell: { ...spell },
    enabled: true,
    weight: 1,
    casts: { 1: 1, 2: 0, 3: 0 }
  }));
  const scenario = {
    ...(request.scenario || {}),
    requiredApByTurn: {},
    ignoredPassiveIds: [...new Set([
      ...(request.scenario?.ignoredPassiveIds || []),
      'deep-purple',
      'turquoise-blue',
      'vermilion-red',
      'yellow-ochre',
      'descent-to-abyss'
    ])]
  };
  const prefiltered = prefilterItems({
    items: request.items,
    sets: request.sets,
    selections,
    constraints: request.constraints,
    turnMode: 't1',
    scenario,
    searchProfile: request.searchProfile
  });
  const ocre = request.items.find((entry) => entry.name === 'Dofus Ocre');
  const koliphant = request.items.find((entry) => entry.name === 'Koliphant Mamukil');
  assert.ok(ocre && koliphant, 'product regression items must exist in normalized data');
  assert.ok(prefiltered.pools.dofus.some((entry) => entry.id === ocre.id), 'Ocre must enter the Dofus pool');
  assert.ok(prefiltered.pools.companion.some((entry) => entry.id === koliphant.id), 'Koliphant must enter the companion pool');

  const dofusProfiles = prefiltered.pools.dofus
    .map((entry) => prefiltered.policy.profileItem(entry))
    .sort((a, b) => b.rankScore - a.rankScore || String(a.item.id).localeCompare(String(b.item.id)));
  const choices = buildGroupChoices(dofusProfiles, 6, {
    policy: prefiltered.policy,
    profile: prefiltered.policy.profile,
    constraints: request.constraints,
    turnMode: 't1',
    scenario,
    slot: 'dofus'
  });
  const ocreIndex = choices.findIndex((choice) => choice.items.some((entry) => entry.id === ocre.id));
  assert.ok(ocreIndex >= 0, 'Ocre must survive the final Dofus diversity reduction');
  assert.ok(
    ocreIndex < prefiltered.policy.profile.refine.dofusComboLimit,
    'an Ocre Dofus group must remain inside the combinations consumed by offensive refinement'
  );

  const ocreKoliphantGenerated = ocreIndex >= 0
    && prefiltered.pools.companion.some((entry) => entry.id === koliphant.id);
  assert.equal(ocreKoliphantGenerated, true, 'the retained Ocre group must be pairable with Koliphant Mamukil');
});
