import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGroupChoices } from '../optimizer/candidate-search.js';

function makeProfile(id, proxy, objective = 0) {
  return {
    item: { id, name: `Synthetic ${id}`, stats: {} },
    optimisticStats: { proxy, objective },
    bounded: true
  };
}

function makeContext(slot) {
  return {
    slot,
    constraints: {},
    turnMode: 't1',
    scenario: {},
    profile: {
      ranking: { constraintWeight: 0 },
      search: {
        dofusGroupBeamWidth: 3,
        multiPickBeamWidth: 3,
        groupBeamWidth: 3,
        groupChoiceLimits: { dofus: 3, ring: 3 },
        groupBucketLimit: 10,
        groupDiversityMultiplier: 0.3,
        groupSpecialistReservePerStat: 0,
        groupOffenseReserve: 0
      }
    },
    policy: {
      paretoKeys: [],
      rankStats(stats = {}) {
        return {
          rankScore: Number(stats.proxy || 0),
          objectiveGain: Number(stats.objective || 0),
          constraintSignal: 0
        };
      }
    }
  };
}

function keys(choices) {
  return choices.map((choice) => choice.items.map((item) => item.id).sort((a, b) => a - b).join('|'));
}

const profiles = [
  makeProfile(101, 10),
  makeProfile(102, 9),
  makeProfile(103, 8),
  makeProfile(104, 1, 100),
  makeProfile(105, 7),
  makeProfile(106, 6)
];

const targetNeighborKey = '101|102|103|104';
const normalProxyKeys = ['101|102|103|105', '101|102|103|106', '101|102|105|106'];

test('buildGroupChoices retains a bounded distance-1 Dofus neighbor at the lossy multi-pick beam', () => {
  const first = buildGroupChoices(profiles, 4, makeContext('dofus'));
  const second = buildGroupChoices(profiles, 4, makeContext('dofus'));
  const proxyOnly = buildGroupChoices(profiles, 4, makeContext('ring'));

  assert.ok(!keys(proxyOnly).includes(targetNeighborKey), 'normal proxy beam reduction must eliminate the neighbor');
  assert.ok(keys(first).includes(targetNeighborKey), 'Dofus beam reserve must retain the relevant distance-1 neighbor');
  assert.equal(first.length, 3, 'retained choice count must stay at the configured limit');
  assert.deepEqual(keys(first), keys(second), 'output must be deterministic');
});

test('buildGroupChoices leaves non-Dofus group behavior unchanged', () => {
  const choices = buildGroupChoices(profiles, 4, makeContext('ring'));

  assert.deepEqual(keys(choices), normalProxyKeys);
  assert.equal(choices.length, 3);
});
