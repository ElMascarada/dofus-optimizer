import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGroupChoices } from '../optimizer/candidate-search.js';

function makeProfile(id, power) {
  return {
    item: { id, name: `Synthetic ${id}`, stats: {} },
    optimisticStats: { power },
    bounded: true
  };
}

function makeContext(slot, onGroupChoiceFinalReduction = null) {
  return {
    slot,
    constraints: {},
    turnMode: 't1',
    scenario: {},
    profile: {
      ranking: { constraintWeight: 0 },
      search: {
        dofusGroupBeamWidth: 20,
        multiPickBeamWidth: 20,
        groupBeamWidth: 20,
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
        const power = Number(stats.power || 0);
        return {
          rankScore: power,
          objectiveGain: power,
          constraintSignal: 0
        };
      }
    },
    onGroupChoiceFinalReduction
  };
}

function keys(choices) {
  return choices.map((choice) => choice.items.map((item) => item.id).sort((a, b) => a - b).join('|'));
}

const profiles = [
  makeProfile(101, 10),
  makeProfile(102, 9),
  makeProfile(103, 8),
  makeProfile(104, 1)
];

const targetNeighborKey = '101|104';

test('buildGroupChoices retains a bounded distance-1 Dofus neighbor without growing output', () => {
  let reduction = null;
  const first = buildGroupChoices(profiles, 2, makeContext('dofus', (trace) => {
    reduction = trace;
  }));
  const second = buildGroupChoices(profiles, 2, makeContext('dofus'));

  assert.ok(reduction, 'final reduction trace must be emitted for the regression surface');
  assert.ok(reduction.candidateKeys.includes(targetNeighborKey), 'neighbor must reach final states');
  assert.ok(!reduction.primaryKeys.includes(targetNeighborKey), 'normal proxy reduction must eliminate the neighbor');
  assert.ok(reduction.retainedKeys.includes(targetNeighborKey), 'bounded reserve must retain the neighbor');
  assert.ok(keys(first).includes(targetNeighborKey), 'returned choices must contain the retained neighbor');
  assert.equal(first.length, 3, 'retained choice count must stay at the configured limit');
  assert.deepEqual(keys(first), keys(second), 'output must be deterministic');
});

test('buildGroupChoices leaves non-Dofus group behavior unchanged', () => {
  let reduction = null;
  const choices = buildGroupChoices(profiles, 2, makeContext('ring', (trace) => {
    reduction = trace;
  }));

  assert.ok(reduction);
  assert.deepEqual(reduction.retainedKeys, reduction.primaryKeys, 'non-Dofus groups must not use the neighbor reserve');
  assert.deepEqual(keys(choices), ['101|102', '101|103', '102|103']);
  assert.equal(choices.length, 3);
});
