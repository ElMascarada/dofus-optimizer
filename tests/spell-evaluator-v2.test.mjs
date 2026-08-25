import test from 'node:test';
import assert from 'node:assert/strict';

import { evaluateSpell } from '../js/spell-evaluator.js';

test('evaluateSpell returns normal, critical and expected damage without running equipment search', () => {
  const result = evaluateSpell({
    id: 'spell-hit',
    name: 'Hit',
    apCost: 3,
    baseCritPct: 20,
    distanceOptions: ['ranged'],
    hits: [{ element: 'fire', normal: [20, 30], crit: [30, 40] }],
    combatModifiers: []
  }, { fire: 100, crit: 10 }, { turn: 1 });

  assert.equal(result.supported, true);
  assert.deepEqual(result.normalDamage, [40, 60]);
  assert.deepEqual(result.criticalDamage, [60, 80]);
  assert.ok(result.expectedDamage > 40 && result.expectedDamage < 80);
});

test('evaluateSpell applies existing target modifiers but reports unsupported spells explicitly', () => {
  const supported = evaluateSpell({
    id: 'spell-hit',
    name: 'Hit',
    apCost: 2,
    baseCritPct: 0,
    hits: [{ element: 'earth', normal: [100, 100], crit: [100, 100] }],
    combatModifiers: []
  }, {}, {
    turn: 1,
    modifiers: [{ id: 'vuln', sourceSpellId: 'x', scope: 'target', stats: { finalDamageTakenPct: 20 }, appliedTurn: 1, expiresAfterTurn: 1 }]
  });
  assert.deepEqual(supported.normalDamage, [120, 120]);

  const unsupported = evaluateSpell({ id: 'unknown', name: 'Unknown', hits: [], combatModifiers: [] }, {}, { turn: 1 });
  assert.equal(unsupported.supported, false);
  assert.equal(unsupported.supportStatus, 'UNSUPPORTED');
  assert.equal(unsupported.normalDamage, null);
});
