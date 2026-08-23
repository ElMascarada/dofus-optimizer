import test from 'node:test';
import assert from 'node:assert/strict';
import {
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

test('theoretical combinations are counted without being materialized', () => {
  assert.equal(theoreticalChoiceCount(320, 6), 1422630723360n);
});
