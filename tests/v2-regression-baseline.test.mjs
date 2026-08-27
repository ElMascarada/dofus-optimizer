import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { prefilterItems } from '../js/candidate-prefilter.js';
import { evaluateCompleteBuild } from '../js/complete-build-evaluator.js';
import { optimizeCombatSequence } from '../js/turn-optimizer.js';

function damageSpell({ id = 'hit', apCost = 4, base = 100, element = 'air', modifiers = [] } = {}) {
  return {
    id,
    name: id,
    apCost,
    baseCritPct: 0,
    maxCastPerTurn: 3,
    maxCastPerTarget: 3,
    distanceOptions: ['melee', 'ranged'],
    hits: [{ element, normal: [base, base], crit: [base, base] }],
    combatModifiers: modifiers,
    combatRelevant: true
  };
}

function supportSpell({ id = 'buff', apCost = 2, stats = { power: 200 }, durationTurns = 2 } = {}) {
  return {
    id,
    name: id,
    apCost,
    baseCritPct: 0,
    maxCastPerTurn: 1,
    maxCastPerTarget: 1,
    hits: [],
    combatModifiers: [{ id: `${id}-modifier`, scope: 'self', stats, durationTurns }],
    combatRelevant: true,
    supportOnly: true
  };
}

function selection(spell) {
  return { spell, enabled: true, weight: 1, casts: { 1: 1, 2: 1, 3: 1 } };
}

function item(id, stats = {}, extra = {}) {
  return { id, name: id, slot: 'hat', stats, certified: true, ...extra };
}

const syntheticCharacter = Object.freeze({
  level: 200,
  characteristicPoints: 0,
  scrolled: { earth: 0, fire: 0, water: 0, air: 0 },
  baseStats: { ap: 11, mp: 5, vit: 1000 }
});

test('baseline: mono-turn optimization remains deterministic', () => {
  const result = optimizeCombatSequence({
    baseStats: { ap: 8, air: 100 },
    spells: [damageSpell({ apCost: 4, base: 100 })],
    objective: { turnMode: 't1', allowSupport: true }
  });

  assert.equal(result.objective.turnMode, 't1');
  assert.deepEqual(result.objective.activeTurns, [1]);
  assert.equal(result.sequence.length, 2);
  assert.equal(Math.round(result.totalDamage), 400);
});

test('baseline: T1-T3 optimization returns three complete turns', () => {
  const result = optimizeCombatSequence({
    baseStats: { ap: 10, air: 100 },
    spells: [damageSpell({ apCost: 4, base: 40 }), supportSpell()],
    objective: { turnMode: 'sum', allowSupport: true },
    beamWidth: 300,
    interTurnWidth: 12
  });

  assert.deepEqual(result.objective.activeTurns, [1, 2, 3]);
  assert.deepEqual(Object.keys(result.perTurn).map(Number), [1, 2, 3]);
  assert.ok(result.perTurn[1] > 0 && result.perTurn[2] > 0 && result.perTurn[3] > 0);
  assert.equal(result.score, result.totalDamage);
});

test('baseline: PA/PM constraints stay hard minimums', () => {
  const spell = damageSpell({ apCost: 4, base: 40 });
  const failing = evaluateCompleteBuild({
    items: [],
    selections: [selection(spell)],
    constraints: { ap: 12, mp: 6 },
    character: syntheticCharacter,
    fmPolicy: { spellDamagePct: 0, allowCritDamage: false, structuralExos: false },
    turnMode: 't1'
  });
  const passing = evaluateCompleteBuild({
    items: [item('resource-hat', { ap: 1, mp: 1 })],
    selections: [selection(spell)],
    constraints: { ap: 12, mp: 6 },
    character: syntheticCharacter,
    fmPolicy: { spellDamagePct: 0, allowCritDamage: false, structuralExos: false },
    turnMode: 't1'
  });

  assert.equal(failing.result, null);
  assert.equal(failing.reason, 'constraint');
  assert.ok(passing.result);
  assert.equal(passing.result.stats.ap, 12);
  assert.equal(passing.result.stats.mp, 6);
});

for (const [label, stat, minimum] of [
  ['initiative', 'initiative', 1600],
  ['vitality', 'vit', 1200],
  ['resistance', 'resEarth', 25]
]) {
  test(`baseline: ${label} constraint influences candidate retention before solve`, () => {
    const spell = damageSpell({ base: 20 });
    const hats = Array.from({ length: 30 }, (_, index) => item(`offense-${index}`, { air: 300 - index, power: 100 }));
    const specialist = item(`${stat}-specialist`, { [stat]: minimum, air: 1 });
    const result = prefilterItems({
      items: [...hats, specialist],
      selections: [selection(spell)],
      constraints: { [stat]: minimum },
      slotLimits: { hat: 18 }
    });

    assert.ok(result.items.some((candidate) => candidate.id === specialist.id), `${stat} specialist was pruned before solve`);
  });
}

test('baseline: set bonuses contribute to final build score', () => {
  const spell = damageSpell({ apCost: 4, base: 50 });
  const set = { id: 'set-a', name: 'Set A', bonuses: { 2: { power: 100 } } };
  const base = {
    selections: [selection(spell)],
    constraints: {},
    character: { ...syntheticCharacter, baseStats: { ap: 8, mp: 6, vit: 1000 } },
    fmPolicy: { spellDamagePct: 0, allowCritDamage: false, structuralExos: false },
    turnMode: 't1'
  };
  const withoutSet = evaluateCompleteBuild({
    ...base,
    items: [item('a'), item('b', {}, { slot: 'cape' })],
    sets: []
  });
  const withSet = evaluateCompleteBuild({
    ...base,
    items: [item('a', {}, { setId: 'set-a' }), item('b', {}, { slot: 'cape', setId: 'set-a' })],
    sets: [set]
  });

  assert.ok(withoutSet.result && withSet.result);
  assert.ok(withSet.result.score > withoutSet.result.score);
  assert.equal(withSet.result.activeSets[0].count, 2);
});

test('baseline: buff/state spells may improve the chosen sequence', () => {
  const hit = damageSpell({ apCost: 5, base: 40 });
  const buff = supportSpell({ apCost: 2, stats: { power: 200 }, durationTurns: 2 });
  const result = optimizeCombatSequence({
    baseStats: { ap: 12, air: 100 },
    spells: [hit, buff],
    objective: { turnMode: 't1', allowSupport: true }
  });

  assert.equal(result.sequence[0].spellId, 'buff');
  assert.ok(result.totalDamage > 240);
});

test('baseline: manual stop keeps partial results in the simplified production path', async () => {
  const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const app = await readFile(new URL('../js/optimizer-v2-app.js', import.meta.url), 'utf8');

  assert.match(index, /optimizer-v2-app\.js/);
  assert.match(app, /function stopSearch\(\)/);
  assert.match(app, /main\.terminate\(\)/);
  assert.match(app, /seeds\.terminate\(\)/);
  assert.match(app, /latestPartialResults/);
  assert.match(app, /Recherche arrêtée/);
});
