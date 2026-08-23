import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCandidateClassifications,
  buildSetObjectiveProfiles,
  offensiveDofusPool
} from '../js/offensive-scope.js';

const earthSpell = {
  id: 'earth-test',
  name: 'Earth test',
  distance: 'ranged',
  baseCritPct: 0,
  hits: [{ element: 'earth', normal: [100, 100], crit: [110, 110] }]
};
const selections = [{ enabled: true, weight: 1, spell: earthSpell, casts: { 1: 1, 2: 1, 3: 1 } }];

test('a dead mono-element item remains a high-value set enabler when its two-piece bonus is offensive', () => {
  const sets = [{
    id: 'set-volkorne-pattern',
    name: 'Volkorne pattern',
    bonuses: {
      2: { power: 100, damageEarth: 20 },
      3: { power: 110, damageEarth: 20 }
    }
  }];
  const items = [
    { id: 'dead-piece', slot: 'hat', setId: 'set-volkorne-pattern', stats: { water: 100 } },
    { id: 'good-piece', slot: 'cape', setId: 'set-volkorne-pattern', stats: { earth: 80 } }
  ];
  const scope = buildCandidateClassifications(items, sets, selections, 'sum', {});
  const dead = scope.byId.get('dead-piece');
  assert.equal(dead.role, 'set-enabler');
  assert.ok(dead.setOffensiveDelta > 0);
  assert.ok(dead.priority > 0);
});

test('two-piece offensive set threshold gets at least as much activation priority as a weaker higher threshold', () => {
  const profiles = buildSetObjectiveProfiles([{
    id: 'set-a',
    name: 'A',
    bonuses: { 2: { power: 100 }, 3: { power: 100 } }
  }], selections, 'sum', {});
  const thresholds = profiles.get('set-a').thresholds;
  const two = thresholds.find((entry) => entry.count === 2);
  const three = thresholds.find((entry) => entry.count === 3);
  assert.ok(two.priority > three.priority);
});

test('pure utility Dofus leaves the offensive pool while damage and required resistance Dofus remain', () => {
  const items = [
    { id: 'kalyptus-like', slot: 'dofus', stats: { prospecting: 30 }, conditions: null },
    { id: 'damage-dofus', slot: 'dofus', stats: { power: 80 }, conditions: null },
    { id: 'res-trophy', slot: 'dofus', stats: { resEarth: 12 }, conditions: null }
  ];
  const scope = buildCandidateClassifications(items, [], selections, 'sum', { resEarth: 40 });
  const pool = offensiveDofusPool(items, scope.byId).map((item) => item.id);
  assert.ok(!pool.includes('kalyptus-like'));
  assert.ok(pool.includes('damage-dofus'));
  assert.ok(pool.includes('res-trophy'));
});

test('Dofus that only supplies an equipment prerequisite remains available', () => {
  const items = [
    { id: 'intel-trophy', slot: 'dofus', stats: { fire: 100 }, conditions: null },
    {
      id: 'conditioned-weapon',
      slot: 'weapon',
      stats: { earth: 100 },
      conditions: { kind: 'condition', stat: 'fire', operator: 'gt', value: 299 }
    }
  ];
  const scope = buildCandidateClassifications(items, [], selections, 'sum', {});
  assert.equal(scope.byId.get('intel-trophy').role, 'prerequisite');
  assert.ok(offensiveDofusPool(items, scope.byId).some((item) => item.id === 'intel-trophy'));
});

test('critical chance is offensive only through its real expected-damage gain', () => {
  const critSpell = {
    id: 'crit-test',
    name: 'Crit test',
    distance: 'ranged',
    baseCritPct: 10,
    hits: [{ element: 'earth', normal: [100, 100], crit: [140, 140] }]
  };
  const critSelections = [{ enabled: true, weight: 1, spell: critSpell, casts: { 1: 1, 2: 1, 3: 1 } }];
  const items = [
    { id: 'crit-item', slot: 'dofus', stats: { crit: 20 }, conditions: null },
    { id: 'utility-item', slot: 'dofus', stats: { prospecting: 30 }, conditions: null }
  ];
  const scope = buildCandidateClassifications(items, [], critSelections, 'sum', {});
  const crit = scope.byId.get('crit-item');
  const utility = scope.byId.get('utility-item');
  assert.equal(crit.role, 'offensive');
  assert.ok(crit.offensiveDelta > 0);
  assert.ok(crit.priority > utility.priority);
  assert.ok(offensiveDofusPool(items, scope.byId).some((item) => item.id === 'crit-item'));
});

test('critical chance is not artificially favored when a spell has no critical damage gain', () => {
  const flatCritSpell = {
    id: 'no-crit-gain',
    name: 'No crit gain',
    distance: 'ranged',
    baseCritPct: 10,
    hits: [{ element: 'earth', normal: [100, 100], crit: [100, 100] }]
  };
  const flatSelections = [{ enabled: true, weight: 1, spell: flatCritSpell, casts: { 1: 1, 2: 1, 3: 1 } }];
  const item = { id: 'crit-only', slot: 'dofus', stats: { crit: 20 }, conditions: null };
  const scope = buildCandidateClassifications([item], [], flatSelections, 'sum', {});
  assert.equal(scope.byId.get('crit-only').role, 'neutral');
});
