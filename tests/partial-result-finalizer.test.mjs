import test from 'node:test';
import assert from 'node:assert/strict';
import {
  combatSpellPool,
  finalizePartialCombatResults
} from '../js/partial-result-finalizer.js';

function damageSpell({ id, element = 'air', base = 40, apCost = 3 } = {}) {
  return {
    id,
    name: id,
    apCost,
    baseCritPct: 0,
    maxCastPerTurn: 4,
    maxCastPerTarget: 4,
    distanceOptions: ['melee', 'ranged'],
    hits: [{ element, normal: [base, base], crit: [base, base] }],
    combatModifiers: [],
    combatRelevant: true
  };
}

function supportSpell(id = 'support') {
  return {
    id,
    name: id,
    apCost: 2,
    baseCritPct: 0,
    maxCastPerTurn: 1,
    maxCastPerTarget: 1,
    hits: [],
    combatModifiers: [{
      id: `${id}-power`,
      scope: 'self',
      stats: { power: 100 },
      durationTurns: 1
    }],
    combatRelevant: true,
    supportOnly: true
  };
}

test('finalizes provisional equipment results into real combat rotations', () => {
  const build = {
    score: 12345,
    items: [{ id: 'hat-a', slot: 'hat' }],
    stats: { ap: 12, air: 100 },
    effectiveStatsByTurn: {
      1: { ap: 12, air: 100 },
      2: { ap: 12, air: 100 },
      3: { ap: 12, air: 100 }
    }
  };
  const hit = damageSpell({ id: 'air-hit', element: 'air', base: 40, apCost: 3 });

  const output = finalizePartialCombatResults({
    results: [build],
    classSpells: [hit],
    combatObjective: {
      element: 'air',
      turnMode: 't1',
      targetMode: 'single',
      allowSupport: true,
      metric: 'total-damage'
    },
    topN: 10
  });

  assert.equal(output.results.length, 1);
  assert.ok(output.results[0].combatPlan, 'expected a combat plan on stopped-search result');
  assert.ok(output.results[0].perTurn[1] > 0, 'expected T1 damage to be finalized');
  assert.ok(output.results[0].combatPlan.sequence.length > 0, 'expected an explicit spell sequence');
  assert.equal(output.diagnostics.stoppedEarly, true);
});

test('keeps support spells while filtering offensive spells to the selected element', () => {
  const air = damageSpell({ id: 'air-hit', element: 'air' });
  const earth = damageSpell({ id: 'earth-hit', element: 'earth' });
  const support = supportSpell();

  const pool = combatSpellPool([air, earth, support], { element: 'air' });

  assert.deepEqual(pool.map((spell) => spell.id), ['air-hit', 'support']);
});
