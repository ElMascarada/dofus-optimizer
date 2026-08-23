import test from 'node:test';
import assert from 'node:assert/strict';
import {
  passiveUpperStats,
  pruneDominatedCandidates,
  theoreticalChoiceCount
} from '../js/search-space.js';

function item(id, power, extra = {}) {
  return {
    id,
    slot: extra.slot || 'dofus',
    slotSubtype: extra.slotSubtype || null,
    setId: extra.setId || null,
    conditions: extra.conditions || null,
    passives: extra.passives || [],
    stats: { power, ...(extra.stats || {}) }
  };
}

test('singleton slots remove a strictly dominated equivalent candidate', () => {
  const result = pruneDominatedCandidates([item('a', 100), item('b', 50)], {
    keys: ['power'],
    groupCount: 1
  });
  assert.deepEqual(result.candidates.map((entry) => entry.id), ['a']);
  assert.equal(result.dominatedRemoved, 1);
});

test('multi-pick slots keep a dominated candidate unless enough replacements exist', () => {
  const two = pruneDominatedCandidates([item('a', 100), item('b', 90)], {
    keys: ['power'],
    groupCount: 2
  });
  assert.deepEqual(two.candidates.map((entry) => entry.id), ['a', 'b']);

  const three = pruneDominatedCandidates([item('a', 100), item('b', 90), item('c', 80)], {
    keys: ['power'],
    groupCount: 2
  });
  assert.deepEqual(three.candidates.map((entry) => entry.id), ['a', 'b']);
});

test('Prysmaradites can use single-replacement dominance because only one is legal', () => {
  const result = pruneDominatedCandidates([
    item('a', 100, { slotSubtype: 'prysmaradite' }),
    item('b', 50, { slotSubtype: 'prysmaradite' })
  ], {
    keys: ['power'],
    groupCount: 6
  });
  assert.deepEqual(result.candidates.map((entry) => entry.id), ['a']);
});

test('unbounded contextual passive stays unbounded without scenario instead of guessing a cap', () => {
  const pryximite = item('pryximite', 0, {
    slotSubtype: 'prysmaradite',
    passives: [{
      id: 'pryximite',
      rules: [{
        trigger: { type: 'turn_in', turns: [1, 2, 3] },
        scaledStats: [
          { stat: 'meleeDamagePct', contextKey: 'start', multiplier: 2, min: 0 },
          { stat: 'meleeDamagePct', contextKey: 'end', multiplier: 2, min: 0 }
        ]
      }]
    }]
  });
  const bound = passiveUpperStats(pryximite);
  assert.equal(bound.bounded, false);
});

test('explicit scenario turns an unbounded contextual passive into an exact safe search bound', () => {
  const pryximite = item('pryximite', 0, {
    slotSubtype: 'prysmaradite',
    passives: [{
      id: 'pryximite',
      rules: [{
        trigger: { type: 'turn_in', turns: [1, 2, 3] },
        scaledStats: [
          { stat: 'meleeDamagePct', contextKey: 'start', multiplier: 2, min: 0 },
          { stat: 'meleeDamagePct', contextKey: 'end', multiplier: 2, min: 0 }
        ]
      }]
    }]
  });
  const bound = passiveUpperStats(pryximite, {
    turnMode: 'sum',
    scenario: { start: 2, end: 3 }
  });
  assert.equal(bound.bounded, true);
  assert.equal(bound.stats.meleeDamagePct, 10);
});

test('scenario bound uses the maximum simultaneous turn contribution, not the sum of different turns', () => {
  const temporal = item('temporal', 0, {
    passives: [{
      id: 'temporal',
      rules: [
        { trigger: { type: 'turn_in', turns: [1] }, stats: { finalDamagePct: 20 } },
        { trigger: { type: 'turn_in', turns: [2] }, stats: { finalDamagePct: 5 } }
      ]
    }]
  });
  const bound = passiveUpperStats(temporal, { turnMode: 'sum', scenario: {} });
  assert.equal(bound.bounded, true);
  assert.equal(bound.stats.finalDamagePct, 20);
});

test('theoretical combinations are counted without being materialized', () => {
  assert.equal(theoreticalChoiceCount(320, 6), 1422630723360n);
});
