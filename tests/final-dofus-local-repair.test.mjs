import test from 'node:test';
import assert from 'node:assert/strict';
import { repairFinalDofusBuild } from '../js/final-dofus-local-repair.js';

function item(id, slot = 'dofus', score = 0, extra = {}) {
  return { id, name: id, slot, level: 200, stats: {}, passives: [], conditions: null, testScore: score, ...extra };
}

function makeBuild(scores = [1, 10, 10, 10, 10, 10], extras = []) {
  const items = [item('hat', 'hat', 0), item('companion', 'companion', 0), ...scores.map((score, index) => item(`d${index + 1}`, 'dofus', score)), ...extras];
  return { items, score: items.reduce((sum, entry) => sum + Number(entry.testScore || 0), 0), equipmentScore: 0 };
}

function fakeEvaluate({ items }) {
  if (items.some((entry) => entry.illegal)) return { result: null, reason: 'fixture-illegal' };
  const score = items.reduce((sum, entry) => sum + Number(entry.testScore || 0), 0);
  return { result: { items: [...items], score, equipmentScore: score, stats: {}, effectiveStatsByTurn: { 1: {}, 2: {}, 3: {} } }, reason: null };
}

function fakeRefine({ results }) {
  return {
    results: results.map((result) => ({
      ...result,
      score: result.items.reduce((sum, entry) => sum + Number(entry.testScore || 0), 0),
      combatPlan: { totalDamage: result.items.reduce((sum, entry) => sum + Number(entry.testScore || 0), 0) }
    }))
  };
}

function repair(build, candidates, options = {}) {
  return repairFinalDofusBuild({
    build,
    candidateItems: candidates,
    turnMode: 't1',
    combatObjective: { turnMode: 't1' },
    evaluateComplete: fakeEvaluate,
    refineFinal: fakeRefine,
    ...options
  });
}

function ids(build) {
  return build.items.map((entry) => entry.id);
}

test('a strictly dominated final Dofus is replaced by the best legal distance-1 swap', () => {
  const build = makeBuild();
  const candidates = [...build.items.filter((entry) => entry.slot === 'dofus'), item('better', 'dofus', 7), item('best', 'dofus', 9)];
  const output = repair(build, candidates);
  assert.equal(output.diagnostics.changed, true);
  assert.equal(output.diagnostics.from, 'd1');
  assert.equal(output.diagnostics.to, 'best');
  assert.ok(ids(output.result).includes('best'));
  assert.ok(!ids(output.result).includes('d1'));
  assert.equal(output.result.score, build.score + 8);
});

test('an already locally optimal final build remains unchanged', () => {
  const build = makeBuild([10, 10, 10, 10, 10, 10]);
  const output = repair(build, [...build.items.filter((entry) => entry.slot === 'dofus'), item('weaker', 'dofus', 9)]);
  assert.equal(output.diagnostics.changed, false);
  assert.equal(output.result, build);
});

test('a stronger but illegal Dofus swap is never retained', () => {
  const build = makeBuild();
  const output = repair(build, [item('illegal-best', 'dofus', 100, { illegal: true }), item('legal-better', 'dofus', 4)]);
  assert.equal(output.diagnostics.changed, true);
  assert.ok(ids(output.result).includes('legal-better'));
  assert.ok(!ids(output.result).includes('illegal-best'));
  assert.equal(output.diagnostics.rejected['fixture-illegal'] > 0, true);
});

test('required locks are not removed and rejected candidates are never equipped', () => {
  const build = makeBuild([1, 100, 100, 100, 100, 100]);
  const locked = repair(build, [item('would-win', 'dofus', 90)], { requiredItemIds: ['d1'] });
  assert.equal(locked.diagnostics.changed, false);
  assert.ok(ids(locked.result).includes('d1'));

  const rejected = repair(build, [item('rejected-win', 'dofus', 90), item('allowed', 'dofus', 2)], { rejectedItemIds: ['rejected-win'] });
  assert.equal(rejected.diagnostics.changed, true);
  assert.ok(ids(rejected.result).includes('allowed'));
  assert.ok(!ids(rejected.result).includes('rejected-win'));
});

test('a local Dofus repair never changes build size', () => {
  const build = makeBuild();
  const output = repair(build, [item('best', 'dofus', 9)]);
  assert.equal(output.result.items.length, build.items.length);
});

test('a local Dofus repair never creates a duplicate Dofus or trophy identity', () => {
  const build = makeBuild();
  build.items.find((entry) => entry.id === 'd2').ankamaId = 42;
  build.items.find((entry) => entry.id === 'd2').name = 'same-trophy';
  const duplicateVariant = item('duplicate-variant', 'dofus', 100, { ankamaId: 42, name: 'same-trophy' });
  const output = repair(build, [duplicateVariant]);
  assert.equal(output.diagnostics.changed, false);
  assert.equal(output.result, build);
});

test('local Dofus repair is deterministic across candidate ordering', () => {
  const build = makeBuild();
  const a = item('a', 'dofus', 9);
  const b = item('b', 'dofus', 9);
  const first = repair(build, [b, a]);
  const second = repair(build, [a, b]);
  assert.deepEqual(ids(first.result), ids(second.result));
  assert.equal(first.diagnostics.to, second.diagnostics.to);
});

test('non-Dofus slots are never modified when no complete-build recovery pool is available', () => {
  const build = makeBuild();
  const companion = build.items.find((entry) => entry.slot === 'companion');
  companion.stats = { crit: 20, critDamage: 80 };
  const penalty = build.items.find((entry) => entry.id === 'd1');
  penalty.stats = { crit: -10 };
  const replacement = item('coherent-trophy', 'dofus', 9, { stats: { power: 40 } });
  const beforeNonDofus = build.items.filter((entry) => entry.slot !== 'dofus').map((entry) => entry.id);
  const output = repair(build, [replacement]);
  assert.equal(output.diagnostics.changed, true);
  assert.deepEqual(output.result.items.filter((entry) => entry.slot !== 'dofus').map((entry) => entry.id), beforeNonDofus);
  assert.equal(output.result.items.find((entry) => entry.slot === 'companion'), companion);
});

test('final recovery lets a set-restoring skeleton recombine companion and Dofus before final scoring', () => {
  const build = makeBuild([8, 8, 8, 8, 8, 8], [item('cape-set-a', 'cape', 0, { setId: 'set-a' })]);
  build.items.find((entry) => entry.id === 'hat').testScore = 1;
  build.score = build.items.reduce((sum, entry) => sum + Number(entry.testScore || 0), 0);

  const setHat = item('hat-set-a', 'hat', 4, { setId: 'set-a' });
  const offensiveCompanion = item('offensive-companion', 'companion', 7);
  const structuralDofus = item('structural-dofus', 'dofus', 6);
  const candidates = [...build.items, setHat, offensiveCompanion, structuralDofus];

  const output = repair(build, candidates);
  assert.equal(output.diagnostics.changed, true);
  assert.equal(output.diagnostics.recovery, 'complete-build-neighborhood');
  assert.equal(output.diagnostics.skeletonChanged, true);
  assert.ok(ids(output.result).includes('hat-set-a'));
  assert.ok(ids(output.result).includes('offensive-companion'));
  assert.ok(ids(output.result).includes('structural-dofus'));
  assert.ok(output.result.score > build.score);
});
