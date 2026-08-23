import test from 'node:test';
import assert from 'node:assert/strict';
import { benchmarkProfile, benchmarkSelection } from '../js/benchmark-spells.js';
import { evaluateObjective } from '../js/spells.js';

function score(id, stats = {}) {
  const profile = benchmarkProfile(id);
  assert.ok(profile, `missing benchmark profile ${id}`);
  return evaluateObjective({
    stats,
    selections: benchmarkSelection(profile),
    turnMode: 'sum'
  }).score;
}

test('high-base Earth benchmark reacts to Earth rather than an unrelated element', () => {
  assert.ok(score('stress-high-base-earth', { earth: 100 }) > score('stress-high-base-earth', { fire: 100 }));
});

test('crit benchmark gains real expected damage from crit chance and crit damage', () => {
  const baseline = score('mono-fire-crit', {});
  assert.ok(score('mono-fire-crit', { crit: 20 }) > baseline);
  assert.ok(score('mono-fire-crit', { critDamage: 20 }) > baseline);
});

test('four-line benchmark values fixed elemental damage more than a one-line nuke', () => {
  const multiDelta = score('earth-multihit', { damageEarth: 10 }) - score('earth-multihit', {});
  const nukeDelta = score('mono-earth-nuke', { damageEarth: 10 }) - score('mono-earth-nuke', {});
  assert.ok(multiDelta > nukeDelta);
});

test('omni benchmark rewards all four elements while mono Earth ignores three of them', () => {
  const balanced = { earth: 100, fire: 100, water: 100, air: 100 };
  const earthOnly = { earth: 100 };
  assert.ok(score('omni-four-elements', balanced) > score('omni-four-elements', earthOnly));
  assert.equal(score('mono-earth-nuke', balanced), score('mono-earth-nuke', earthOnly));
});

test('melee control benchmark responds to melee damage but not ranged damage', () => {
  assert.ok(score('melee-vs-ranged-control', { meleeDamagePct: 10 }) > score('melee-vs-ranged-control', {}));
  assert.equal(score('melee-vs-ranged-control', { rangedDamagePct: 10 }), score('melee-vs-ranged-control', {}));
});
