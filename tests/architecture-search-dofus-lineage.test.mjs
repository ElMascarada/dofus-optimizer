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

function state(dofusId, gearId, earth, lineagePromise) {
  const items = [item(dofusId, 'dofus'), item(gearId, 'hat', earth)];
  return {
    items,
    ids: new Set(items.map((entry) => String(entry.id))),
    heuristic: 0,
    dofusLineageObjectiveScore: lineagePromise
  };
}

function context({ lineageReserve = 2 } = {}) {
  return {
    setsById: {},
    constraints: {},
    fmPolicy: {},
    profile: {
      ranking: { constraintProgressWeight: 0 },
      search: {
        stateBucketLimit: 10,
        groupSpecialistReservePerStat: 0,
        groupOffenseReserve: lineageReserve
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

test('architecture state reduction preserves a promising generated Dofus lineage through temporary child ranking loss', () => {
  const target = state('dofus-target', 'target-child', 10, 1000);
  const dominant = [
    state('dofus-dominant', 'dominant-a', 100, 900),
    state('dofus-dominant', 'dominant-b', 90, 900),
    state('dofus-dominant', 'dominant-c', 80, 900)
  ];

  const kept = keepDiverseStates([target, ...dominant], context(), 3);
  const retainedKeys = keys(kept);

  assert.equal(kept.length, 3, 'lineage protection must not grow the configured state beam');
  assert.ok(retainedKeys.includes('dofus-target|target-child'), 'promising target Dofus lineage must survive the cross-slot beam');
  assert.ok(retainedKeys.includes('dofus-dominant|dominant-a'), 'best state from the dominant lineage must remain represented');
});

test('architecture state reduction does not reserve mediocre Dofus lineages outside the bounded promise lane', () => {
  const promising = state('dofus-promising', 'promising-child', 10, 1000);
  const dominant = [
    state('dofus-dominant', 'dominant-a', 100, 900),
    state('dofus-dominant', 'dominant-b', 90, 900)
  ];
  const mediocre = state('dofus-mediocre', 'mediocre-child', 95, 1);

  const kept = keepDiverseStates([promising, ...dominant, mediocre], context({ lineageReserve: 2 }), 3);
  const retainedKeys = keys(kept);

  assert.equal(kept.length, 3, 'bounded promise lane must not grow the beam');
  assert.ok(retainedKeys.includes('dofus-promising|promising-child'));
  assert.ok(retainedKeys.includes('dofus-dominant|dominant-a'));
  assert.ok(retainedKeys.includes('dofus-dominant|dominant-b'), 'remaining beam capacity must stay available to global ranking');
  assert.ok(!retainedKeys.includes('dofus-mediocre|mediocre-child'), 'mediocre lineage must not receive unconditional protection');
});

test('architecture state reduction leaves non-Dofus ranking behavior unchanged', () => {
  const states = [
    state('placeholder-a', 'a', 100, 1000),
    state('placeholder-b', 'b', 90, 900),
    state('placeholder-c', 'c', 80, 800),
    state('placeholder-d', 'd', 10, 700)
  ].map((entry) => ({
    ...entry,
    items: entry.items.filter((candidate) => candidate.slot !== 'dofus'),
    ids: new Set(entry.items.filter((candidate) => candidate.slot !== 'dofus').map((candidate) => String(candidate.id)))
  }));

  const kept = keepDiverseStates(states, context(), 3);

  assert.deepEqual(keys(kept), ['a', 'b', 'c']);
});
