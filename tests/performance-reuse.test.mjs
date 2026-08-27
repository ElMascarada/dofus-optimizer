import test from 'node:test';
import assert from 'node:assert/strict';

import {
  branchFeasibility,
  createBranchFeasibilityEnvelope,
  staticBuildStats
} from '../optimizer/candidate-search.js';

function item(id, slot, stats = {}, extra = {}) {
  return { id, name: id, slot, stats, passives: [], conditions: null, certified: true, ...extra };
}

function profile(entry, optimisticStats = entry.stats, bounded = true) {
  return { item: entry, optimisticStats, bounded, rankScore: 0, objectiveGain: 0 };
}

const sets = [{
  id: 'perf-set',
  name: 'Perf Set',
  bonuses: { 2: { initiative: 300, resEarth: 4 } }
}];
const setsById = Object.fromEntries(sets.map((set) => [set.id, set]));

function fixture() {
  const ringA = item('ring-a', 'ring', { ap: 1, initiative: 700, resEarth: 5 }, { setId: 'perf-set' });
  const ringB = item('ring-b', 'ring', { mp: 1, initiative: 650, resEarth: 6 }, { setId: 'perf-set' });
  const ringC = item('ring-c', 'ring', { initiative: 1000, vit: 500, resEarth: 9 });
  const profilesBySlot = {
    ring: [profile(ringA), profile(ringB), profile(ringC)]
  };
  return {
    profilesFor: (slot) => profilesBySlot[slot] || [],
    remainingGroups: [{ id: 'ring', missing: 2 }]
  };
}

test('une enveloppe de faisabilité réutilisée garde exactement la décision fraîche', () => {
  const { profilesFor, remainingGroups } = fixture();
  const anchors = [item('amulet', 'amulet', { ap: 2, mp: 1, initiative: 900, vit: 450, resEarth: 8 })];
  const constraints = { ap: 12, mp: 6, initiative: 2500, vit: 1800, resEarth: 20 };
  const envelope = createBranchFeasibilityEnvelope({ remainingGroups, profilesFor, constraints, sets });
  const currentStats = staticBuildStats(anchors, setsById);

  const fresh = branchFeasibility({
    items: anchors,
    remainingGroups,
    profilesFor,
    constraints,
    sets,
    setsById
  });
  const reused = branchFeasibility({
    items: anchors,
    remainingGroups,
    profilesFor,
    constraints,
    sets,
    setsById,
    currentStats,
    envelope
  });

  assert.deepEqual(reused, fresh);
});

test('le cache interne ne change ni la contrainte bloquante ni la borne', () => {
  const { profilesFor, remainingGroups } = fixture();
  const anchors = [item('hat', 'hat', { initiative: 100 })];
  const constraints = { initiative: 5000, resEarth: 40 };

  const first = branchFeasibility({ items: anchors, remainingGroups, profilesFor, constraints, sets, setsById });
  const second = branchFeasibility({ items: anchors, remainingGroups, profilesFor, constraints, sets, setsById });

  assert.deepEqual(second, first);
  assert.equal(first.feasible, false);
  assert.equal(first.key, 'initiative');
});

test('une forme impossible reste impossible avec enveloppe pré-calculée', () => {
  const remainingGroups = [{ id: 'ring', missing: 2 }];
  const onlyRing = item('only-ring', 'ring', { initiative: 500 });
  const profilesFor = (slot) => slot === 'ring' ? [profile(onlyRing)] : [];
  const constraints = { initiative: 1000 };
  const envelope = createBranchFeasibilityEnvelope({ remainingGroups, profilesFor, constraints, sets: [] });

  const result = branchFeasibility({
    items: [],
    remainingGroups,
    profilesFor,
    constraints,
    sets: [],
    setsById: {},
    envelope
  });

  assert.deepEqual(result, { feasible: false, key: 'shape', actual: 0, maximum: 0, target: 1 });
});
