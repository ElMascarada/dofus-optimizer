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

function makeWideContext(slot) {
  const context = makeContext(slot);
  context.profile.search.dofusGroupBeamWidth = 72;
  context.profile.search.multiPickBeamWidth = 72;
  context.profile.search.groupBeamWidth = 72;
  context.profile.search.groupChoiceLimits = { dofus: 72, ring: 72 };
  context.profile.search.groupBucketLimit = 1000;
  context.profile.search.groupDiversityMultiplier = 1;
  return context;
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

test('buildGroupChoices preserves a deep diverse child from a represented parent without growing the beam', () => {
  const parentProfiles = [
    makeProfile(100, 86, 669),
    makeProfile(101, 82, 100),
    makeProfile(102, 7, 412),
    makeProfile(103, 93, 347),
    makeProfile(104, 13, 254),
    makeProfile(105, 24, 194),
    makeProfile(106, 68, 459),
    makeProfile(107, 17, 432),
    makeProfile(108, 23, 285),
    makeProfile(109, 59, 255),
    makeProfile(110, 9, 453),
    makeProfile(111, 70, 100),
    makeProfile(112, 6, 667),
    makeProfile(113, 69, 856),
    makeProfile(114, 1, 992),
    makeProfile(115, 11, 948),
    makeProfile(116, 96, 869),
    makeProfile(117, 30, 170),
    makeProfile(118, 52, 497),
    makeProfile(119, 61, 218)
  ];
  const targetKey = '100|101|103|114';
  const targetIndex = parentProfiles.findIndex((profile) => profile.item.id === 114);
  const siblings = parentProfiles
    .slice(4)
    .map((profile) => ({ id: profile.item.id, proxy: profile.optimisticStats.proxy }))
    .sort((a, b) => b.proxy - a.proxy || a.id - b.id);
  const siblingProxyRank = 1 + siblings.findIndex((profile) => profile.id === 114);

  const first = buildGroupChoices(parentProfiles, 4, makeWideContext('dofus'));
  const second = buildGroupChoices(parentProfiles, 4, makeWideContext('dofus'));
  const proxyOnly = buildGroupChoices(parentProfiles, 4, makeWideContext('ring'));

  assert.ok(targetIndex >= 0);
  assert.ok(siblingProxyRank >= 14, 'fixture must exercise a child deeper than a small top-proxy lane');
  assert.ok(!keys(proxyOnly).includes(targetKey), 'flat proxy retention must eliminate the deep child');
  assert.ok(keys(first).includes(targetKey), 'parent lane must retain a diverse child from the represented parent');
  assert.equal(first.length, 72, 'parent lane must replace global states rather than grow the beam');
  assert.deepEqual(keys(first), keys(second), 'parent-child lane must remain deterministic');
});

test('buildGroupChoices leaves non-Dofus group behavior unchanged', () => {
  const choices = buildGroupChoices(profiles, 4, makeContext('ring'));

  assert.deepEqual(keys(choices), normalProxyKeys);
  assert.equal(choices.length, 3);
});