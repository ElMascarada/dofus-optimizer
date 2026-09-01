import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGroupChoices } from '../optimizer/candidate-search.js';

function makeProfile(id, proxy) {
  return {
    item: { id, name: `Synthetic ${id}`, stats: {} },
    optimisticStats: { proxy, objective: 0 },
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
        dofusGroupBeamWidth: 8,
        multiPickBeamWidth: 8,
        groupBeamWidth: 8,
        groupChoiceLimits: { dofus: 8, ring: 8 },
        groupBucketLimit: 1000,
        groupDiversityMultiplier: 1,
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

const profiles = [24, 18, 22, 13, 9, 1, 12, 4, 6]
  .map((proxy, index) => makeProfile(200 + index, proxy));
const targetParentKey = '200|201|203';
const targetChildKey = '200|201|203|206';

test('buildGroupChoices lets a late Dofus parent representative compete for the bounded global reserve', () => {
  let trace = null;
  const firstContext = makeContext('dofus');
  firstContext.traceParentKey = targetParentKey;
  firstContext.traceChildKey = targetChildKey;
  firstContext.onDofusParentChildTrace = (value) => { trace = value; };

  const first = buildGroupChoices(profiles, 4, firstContext);
  const second = buildGroupChoices(profiles, 4, makeContext('dofus'));
  const primaryOnly = buildGroupChoices(profiles, 4, makeContext('ring'));

  assert.ok(trace, 'fixture must capture parent-child reserve trace');
  assert.equal(trace.WINNER_CHILD_PRESENT_IN_PRIMARY_STATES, false,
    'fixture target must be absent from the primary pick-4 reduction');
  assert.equal(trace.WINNER_CHILD_PRESENT_IN_PARENT_CHILD_REPRESENTATIVES, true,
    'fixture target must already qualify as a parent-lane representative');
  assert.ok(trace.WINNER_PARENT_ORDER_IN_PARENT_LANES > trace.RESERVE_LIMIT,
    'fixture target parent must sit beyond the old order-limited reserve frontier');
  assert.equal(trace.WINNER_CHILD_ENTERED_PROTECTED_STATES, true,
    'global representative competition must retain the quality-ranked late-lane child');
  assert.ok(!keys(primaryOnly).includes(targetChildKey),
    'non-Dofus primary reduction must still eliminate the target');
  assert.ok(keys(first).includes(targetChildKey), 'Dofus final beam must retain the protected target');
  assert.equal(first.length, 8, 'global reserve must replace states rather than grow the beam');
  assert.deepEqual(keys(first), keys(second), 'global reserve selection must remain deterministic');
});
