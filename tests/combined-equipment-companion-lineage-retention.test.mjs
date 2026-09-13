import test from 'node:test';
import assert from 'node:assert/strict';

import {
  retainCompletedEquipmentArchitectureSpecialists,
  retainCompanionParentMarginals
} from '../optimizer/combined-set-core-search.js';

function item(id, slot, stats = {}) {
  return { id, name: id, slot, stats };
}

function equipmentState({ coreId, shieldId, score, fire = 0, water = 0, crit = 0 }) {
  return {
    cores: [{ id: coreId }],
    items: [item(`${coreId}-base`, 'hat'), item(shieldId, 'shield')],
    stats: { fire, water, crit },
    score,
    meanScore: score,
    completionScore: score,
    constraintSignal: 0
  };
}

const context = {
  specialistKeys: ['fire', 'water', 'crit'],
  setsById: {},
  fmPolicy: {},
  constraints: {}
};

test('completed equipment keeps best and semantic specialists per architecture', () => {
  const states = [
    equipmentState({ coreId: 'arch-a', shieldId: 'a-best', score: 120, fire: 100 }),
    equipmentState({ coreId: 'arch-a', shieldId: 'a-water', score: 90, water: 300 }),
    equipmentState({ coreId: 'arch-a', shieldId: 'a-crit', score: 80, crit: 50 }),
    equipmentState({ coreId: 'arch-b', shieldId: 'b-best', score: 200, fire: 200 })
  ];

  const retained = retainCompletedEquipmentArchitectureSpecialists(states, context);
  const ids = new Set(retained.flatMap((state) => state.items.map((entry) => entry.id)));

  assert.ok(ids.has('a-best'));
  assert.ok(ids.has('a-water'));
  assert.ok(ids.has('a-crit'));
  assert.ok(ids.has('b-best'));
});

test('companion retention reserves strong parent-child marginal gains', () => {
  const parents = [
    equipmentState({ coreId: 'arch-a', shieldId: 'a', score: 100 }),
    equipmentState({ coreId: 'arch-b', shieldId: 'b', score: 200 }),
    equipmentState({ coreId: 'arch-c', shieldId: 'c', score: 190 }),
    equipmentState({ coreId: 'arch-d', shieldId: 'd', score: 180 })
  ];

  const gains = new Map([
    ['arch-a', 50],
    ['arch-b', 10],
    ['arch-c', 15],
    ['arch-d', 20]
  ]);

  const rows = parents.map((parent) => {
    const coreId = parent.cores[0].id;
    const companion = item(`${coreId}-companion`, 'companion');
    const score = parent.score + gains.get(coreId);
    return {
      ...parent,
      items: [...parent.items, companion],
      score,
      meanScore: score,
      completionScore: score
    };
  });

  const retained = retainCompanionParentMarginals(parents, rows, 3, context);
  const retainedIds = new Set(retained.flatMap((state) => state.items.map((entry) => entry.id)));

  assert.equal(retained.length, 3);
  assert.ok(retainedIds.has('arch-a-companion'), 'largest marginal gain must survive despite low absolute score');
});
