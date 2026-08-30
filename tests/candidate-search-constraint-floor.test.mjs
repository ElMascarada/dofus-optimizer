import test from 'node:test';
import assert from 'node:assert/strict';
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
  const generatorConstraints = { ap: 2, mp: 1 };
  const profile = {
    ranking: { constraintWeight: 1_000_000 },
    search: {
      dofusGroupBeamWidth: 3,
      multiPickBeamWidth: 3,
      groupBeamWidth: 3,
      groupBucketLimit: 4,
      groupDiversityMultiplier: 1,
      groupSpecialistReservePerStat: 0,
      groupOffenseReserve: 0,
      groupChoiceLimits: { dofus: 2 }
    }
  };
  const policy = {
    paretoKeys: [],
    rankStats(stats = {}) {
      const objectiveGain = Math.max(0, Number(stats.earth || 0));
      const constraintSignal = Math.min(1, Math.max(0, Number(stats.ap || 0)) / 2)
        + Math.min(1, Math.max(0, Number(stats.mp || 0)));
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
    profileItem(item('damage', { ap: 1, mp: 1, earth: 200 }, { prysma: true })),
    profileItem(item('surplus-a', { ap: 2 })),
    profileItem(item('surplus-b', { ap: 1, mp: 2 }, { prysma: true }))
  ];

  const choices = buildGroupChoices(profiles, 2, generatorContext());
  const keys = choices.map((choice) => choice.items.map((entry) => entry.id).sort().join('|'));

  assert.ok(
    keys.includes('damage|ocre'),
    'meeting the floor with Ocre plus offense must not lose solely to PA/PM surplus'
  );
});
