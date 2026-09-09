import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  evaluateSyntheticOffense,
  compareSyntheticOffenseResults,
  SYNTHETIC_OFFENSE_PROFILES
} from '../js/synthetic-offense.js';

const EPS = 1e-9;
const close = (actual, expected, message) => assert.ok(Math.abs(actual - expected) <= EPS, `${message || 'value'}: expected ${expected}, got ${actual}`);
const probe = (result, element, profile) => result.requestedProbes.find((entry) => entry.element === element && entry.profile === profile);

function result(options = {}) {
  return evaluateSyntheticOffense({ stats: {}, availableAp: 12, elements: ['earth'], profiles: ['small'], ...options });
}

test('neutral mono baseline preserves 1 AP = 10 normal synthetic base', () => {
  const evaluated = result({ profiles: ['small', 'medium', 'large'] });
  for (const name of ['small', 'medium', 'large']) {
    const entry = probe(evaluated, 'earth', name);
    close(entry.normalFullProbeValue * entry.equivalentProbeCount, 120, name);
  }
});

test('neutral multi baseline preserves four continuous lines including 7.5 medium', () => {
  const evaluated = result({ elements: ['multi'], profiles: ['small', 'medium', 'large'] });
  for (const name of ['small', 'medium', 'large']) {
    const entry = probe(evaluated, 'multi', name);
    assert.deepEqual(entry.lines.map((line) => line.element), ['earth', 'fire', 'water', 'air']);
    close(entry.normalFullProbeValue * entry.equivalentProbeCount, 120, name);
  }
  assert.deepEqual(probe(evaluated, 'multi', 'medium').lines.map((line) => line.normalBase), [7.5, 7.5, 7.5, 7.5]);
  close(probe(evaluated, 'multi', 'medium').normalFullProbeValue, 30, 'medium multi full normal');
});

test('profile base crit chances and +25% critical bases are exact', () => {
  const evaluated = result({ profiles: ['small', 'medium', 'large'] });
  for (const [name, chance] of [['small', 15], ['medium', 20], ['large', 25]]) {
    const entry = probe(evaluated, 'earth', name);
    assert.equal(entry.baseCritChancePct, chance);
    assert.equal(entry.effectiveCritChancePct, chance);
    close(entry.lines[0].criticalBase, entry.lines[0].normalBase * 1.25, `${name} crit base`);
  }
  const multi = probe(result({ elements: ['multi'], profiles: ['medium'] }), 'multi', 'medium');
  for (const line of multi.lines) close(line.criticalBase, 9.375, 'multi crit line base');
});

test('equipment crit uses canonical percentage-point semantics and legal 0..100 cap', () => {
  assert.equal(probe(result({ stats: { crit: 17 } }), 'earth', 'small').effectiveCritChancePct, 32);
  assert.equal(probe(result({ stats: { crit: 500 } }), 'earth', 'small').effectiveCritChancePct, 100);
  assert.equal(probe(result({ stats: { crit: -500 } }), 'earth', 'small').effectiveCritChancePct, 0);
});

test('critical damage affects only critical branch and expected value through p', () => {
  const baseline = probe(result({ stats: { crit: 10 } }), 'earth', 'small');
  const boosted = probe(result({ stats: { crit: 10, critDamage: 8 } }), 'earth', 'small');
  close(boosted.normalFullProbeValue, baseline.normalFullProbeValue, 'normal unchanged');
  close(boosted.criticalFullProbeValue, baseline.criticalFullProbeValue + 8, 'crit +8');
  close(boosted.expectedFullProbeValue, baseline.expectedFullProbeValue + 8 * 0.25, 'expected + p*8');
});

test('canonical offensive stat vocabulary is applied continuously', () => {
  const entry = probe(result({
    profiles: ['large'],
    stats: { earth: 100, power: 50, damage: 3, damageEarth: 7, crit: 15, critDamage: 8 }
  }), 'earth', 'large');
  close(entry.normalFullProbeValue, 40 * 2.5 + 10, 'earth + power + flats');
  close(entry.criticalFullProbeValue, 50 * 2.5 + 10 + 8, 'critical branch');
  close(entry.expectedFullProbeValue, entry.normalFullProbeValue * 0.6 + entry.criticalFullProbeValue * 0.4, 'expected');
});

test('odd AP budget prorates the complete selected profile', () => {
  const large = probe(result({ availableAp: 11, profiles: ['large'] }), 'earth', 'large');
  close(large.equivalentProbeCount, 2.75, 'large count');
  close(large.totalApBudgetScore, large.expectedFullProbeValue * 2.75, 'large total');
  const medium = probe(result({ availableAp: 10, profiles: ['medium'] }), 'earth', 'medium');
  close(medium.equivalentProbeCount, 10 / 3, 'medium count');
  close(medium.totalApBudgetScore, medium.expectedFullProbeValue * (10 / 3), 'medium total');
});

test('flat damage remainder is prorated rather than reapplied as a fake attack', () => {
  const entry = probe(result({ availableAp: 11, profiles: ['large'], stats: { damage: 20, damageEarth: 7 } }), 'earth', 'large');
  close(entry.partialFactor, 0.75, 'partial factor');
  close(entry.totalApBudgetScore - entry.expectedFullProbeValue * entry.fullCount, entry.expectedFullProbeValue * 0.75, 'partial contribution');
});

test('profiles differentiate naturally through flat damage and crit profile semantics', () => {
  const neutral = result({ profiles: ['small', 'medium', 'large'] });
  for (const name of ['small', 'medium', 'large']) close(probe(neutral, 'earth', name).normalFullProbeValue * probe(neutral, 'earth', name).equivalentProbeCount, 120, 'neutral budget');
  const flat = result({ stats: { damage: 10 }, profiles: ['small', 'large'] });
  assert.ok(probe(flat, 'earth', 'small').totalApBudgetScore > probe(flat, 'earth', 'large').totalApBudgetScore);
  const crit = result({ stats: { crit: 13, critDamage: 17 }, profiles: ['small', 'medium', 'large'] });
  const critScores = ['small', 'medium', 'large'].map((name) => probe(crit, 'earth', name).totalApBudgetScore);
  assert.equal(new Set(critScores).size, 3);
});

test('multi lines are element-independent and generic/elemental flats apply per canonical line', () => {
  const baseline = probe(result({ elements: ['multi'], profiles: ['large'] }), 'multi', 'large');
  const earth = probe(result({ elements: ['multi'], profiles: ['large'], stats: { earth: 100 } }), 'multi', 'large');
  close(earth.lines[0].normalValue - baseline.lines[0].normalValue, 10, 'earth gain');
  for (let index = 1; index < 4; index++) close(earth.lines[index].normalValue, baseline.lines[index].normalValue, `line ${index} unchanged`);

  const flats = probe(result({ elements: ['multi'], profiles: ['large'], stats: { damage: 3, damageEarth: 7 } }), 'multi', 'large');
  close(flats.normalFullProbeValue - baseline.normalFullProbeValue, 3 * 4 + 7, 'multi flat contribution');
  assert.deepEqual(flats.lines.map((line) => line.genericFlatDamage), [3, 3, 3, 3]);
  assert.deepEqual(flats.lines.map((line) => line.elementalFlatDamage), [7, 0, 0, 0]);
});

test('multi odd AP remainder prorates the complete four-line result', () => {
  const entry = probe(result({ availableAp: 11, elements: ['multi'], profiles: ['large'], stats: { damage: 5, damageEarth: 2, critDamage: 4 } }), 'multi', 'large');
  assert.equal(entry.lines.length, 4);
  close(entry.equivalentProbeCount, 2.75, 'multi count');
  close(entry.totalApBudgetScore - entry.expectedFullProbeValue * 2, entry.expectedFullProbeValue * 0.75, 'multi remainder');
});

test('multiple elements and profiles form the exact Cartesian probe set', () => {
  const evaluated = result({ elements: ['fire', 'water'], profiles: ['small', 'large'] });
  assert.deepEqual(evaluated.requestedProbes.map(({ element, profile }) => `${element}/${profile}`), ['fire/small', 'fire/large', 'water/small', 'water/large']);
});

test('balanced ranking maximizes minimum before mean', () => {
  const specialized = result({ elements: ['fire', 'water'], profiles: ['large'], stats: { fire: 900 } });
  const balanced = result({ elements: ['fire', 'water'], profiles: ['large'], stats: { fire: 300, water: 300 } });
  assert.ok(balanced.minimumScore > specialized.minimumScore);
  assert.ok(compareSyntheticOffenseResults(balanced, specialized) > 0);
});

test('mean score is the secondary ranking key when minimum is tied', () => {
  const a = result({ elements: ['fire', 'water'], profiles: ['large'], stats: { fire: 100 } });
  const b = result({ elements: ['fire', 'water'], profiles: ['large'], stats: { fire: 200 } });
  close(a.minimumScore, b.minimumScore, 'minimum tie');
  assert.ok(b.meanScore > a.meanScore);
  assert.ok(compareSyntheticOffenseResults(b, a) > 0);
});

test('one to three mono elements accepted, four rejected, multi is exclusive', () => {
  for (const elements of [['earth'], ['earth', 'fire'], ['earth', 'fire', 'water']]) assert.doesNotThrow(() => result({ elements }));
  assert.throws(() => result({ elements: ['earth', 'fire', 'water', 'air'] }), /At most three/);
  assert.doesNotThrow(() => result({ elements: ['multi'] }));
  assert.throws(() => result({ elements: ['multi', 'earth'] }), /exclusive/);
});

test('public evaluator needs no class, spell, source or combat planner input', async () => {
  const evaluated = evaluateSyntheticOffense({ stats: { earth: 100 }, availableAp: 12, elements: ['earth'], profiles: ['medium'] });
  assert.equal(evaluated.requestedProbes.length, 1);
  assert.equal(SYNTHETIC_OFFENSE_PROFILES.medium.multiLineBase, 7.5);
  const source = await readFile(new URL('../js/synthetic-offense.js', import.meta.url), 'utf8');
  for (const forbidden of ['spells.js', 'source-certification', 'certified-t1', 'turn-optimizer', 'combat-turn-refiner']) {
    assert.equal(source.includes(forbidden), false, `forbidden dependency: ${forbidden}`);
  }
  assert.equal(/classId|className|breedId/.test(source), false);
});
