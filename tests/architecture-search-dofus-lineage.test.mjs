import test from 'node:test';
import assert from 'node:assert/strict';
import { keepDiverseStates } from '../js/architecture-search-v2.js';

function item(id, slot, earth = 0) {
  return {
    id,
    name: id,
    level: 200,
    slot,
    setId: null,
    stats: earth ? { earth } : {},
    passives: [],
    conditions: null,
    slotSubtype: null,
    typeName: slot
  };
}

function state(dofusId, gearId, earth) {
  const items = [item(dofusId, 'dofus'), item(gearId, 'hat', earth)];
  return {
    items,
    ids: new Set(items.map((entry) => String(entry.id))),
    heuristic: 0
  };
}

function context() {
  return {
    setsById: {},
    constraints: {},
    fmPolicy: {},
    profile: {
      ranking: { constraintProgressWeight: 0 },
      search: {
        stateBucketLimit: 10,
        groupSpecialistReservePerStat: 0
      }
    },
    policy: {
      paretoKeys: [],
      rankStats(stats = {}) {
        return { rankScore: Number(stats.earth || 0) };
      }
    }
  };
}

function keys(states) {
  return states.map((entry) => [...entry.ids].sort().join('|'));
}

test('architecture state reduction keeps every already-generated Dofus lineage when the beam can represent them', () => {
  const target = state('dofus-target', 'target-child', 10);
  const dominant = [
    state('dofus-dominant', 'dominant-a', 100),
    state('dofus-dominant', 'dominant-b', 90),
    state('dofus-dominant', 'dominant-c', 80)
  ];

  const kept = keepDiverseStates([target, ...dominant], context(), 3);
  const retainedKeys = keys(kept);

  assert.equal(kept.length, 3, 'lineage protection must not grow the configured state beam');
  assert.ok(retainedKeys.includes('dofus-target|target-child'), 'generated target Dofus lineage must survive the cross-slot beam');
  assert.ok(retainedKeys.includes('dofus-dominant|dominant-a'), 'best state from the dominant lineage must remain represented');
});

test('architecture state reduction leaves non-Dofus ranking behavior unchanged', () => {
  const states = [
    state('placeholder-a', 'a', 100),
    state('placeholder-b', 'b', 90),
    state('placeholder-c', 'c', 80),
    state('placeholder-d', 'd', 10)
  ].map((entry) => ({
    ...entry,
    items: entry.items.filter((candidate) => candidate.slot !== 'dofus'),
    ids: new Set(entry.items.filter((candidate) => candidate.slot !== 'dofus').map((candidate) => String(candidate.id)))
  }));

  const kept = keepDiverseStates(states, context(), 3);

  assert.deepEqual(keys(kept), ['a', 'b', 'c']);
});
