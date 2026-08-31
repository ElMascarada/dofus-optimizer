import test from 'node:test';
import assert from 'node:assert/strict';
import { coreDifferenceCount, diversifyBuilds, prysmaraditeKey } from '../js/result-diversity.js';

function item(id, slot = 'hat', prysma = false) {
  return { id, slot: prysma ? 'dofus' : slot, slotSubtype: prysma ? 'prysmaradite' : null };
}

function build(score, ids, prysma = null) {
  const slots = ['hat', 'cape', 'amulet', 'ring', 'ring', 'belt', 'boots', 'weapon', 'shield', 'companion'];
  const items = ids.map((id, index) => item(id, slots[index] || 'dofus'));
  if (prysma) items.push(item(prysma, 'dofus', true));
  return { score, items };
}

function assertScoresNonIncreasing(results) {
  for (let index = 1; index < results.length; index++) {
    assert.ok(results[index - 1].score >= results[index].score);
  }
}

test('prysma mode returns different Prysmaradites before repeating one', () => {
  const builds = [
    build(1000, ['a','b','c'], 'prysma-a'),
    build(999, ['a','b','d'], 'prysma-a'),
    build(995, ['a','b','e'], 'prysma-b'),
    build(990, ['a','b','f'], 'prysma-c')
  ];
  const results = diversifyBuilds(builds, 'prysma', 3);
  assert.deepEqual(results.map(prysmaraditeKey), ['prysma-a', 'prysma-b', 'prysma-c']);
});

test('gear mode retains broader alternative membership', () => {
  const base = build(1000, ['a','b','c','d','e','f']);
  const tiny = build(999, ['a','b','c','d','e','x']);
  const different = build(980, ['a','y','z','d','q','f']);
  const results = diversifyBuilds([base, tiny, different], 'gear', 2);
  assert.equal(results[0], base);
  assert.ok(results.includes(different));
  assert.ok(coreDifferenceCount(base, different) >= 3);
});

test('diversity selects membership while score determines final rank', () => {
  const bestA = build(1000, ['a','b','c'], 'prysma-a');
  const repeatedA = build(950, ['a','b','d'], 'prysma-a');
  const excludedA = build(940, ['a','b','e'], 'prysma-a');
  const bestB = build(900, ['a','b','f'], 'prysma-b');

  const results = diversifyBuilds([bestA, repeatedA, excludedA, bestB], 'prysma', 3);

  assert.deepEqual(new Set(results), new Set([bestA, repeatedA, bestB]));
  assert.ok(!results.includes(excludedA));
  assert.deepEqual(results.map((entry) => entry.score), [1000, 950, 900]);
});

test('all result modes return scores in monotonically non-increasing order', () => {
  const builds = [
    build(1000, ['a','b','c','d','e','f'], 'prysma-a'),
    build(975, ['a','b','c','d','e','x'], 'prysma-a'),
    build(950, ['a','b','c','d','x','y'], 'prysma-a'),
    build(900, ['a','b','u','v','w','z'], 'prysma-b')
  ];

  for (const mode of ['score', 'prysma', 'gear', 'gear-4']) {
    assertScoresNonIncreasing(diversifyBuilds(builds, mode, 3));
  }
});

test('score mode preserves pure ranking', () => {
  const a = build(50, ['a']);
  const b = build(80, ['b']);
  assert.deepEqual(diversifyBuilds([a, b], 'score', 2), [b, a]);
});
