import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPassiveModifiers, passiveTriggerMatches, passiveTriggerState } from '../js/passives.js';

const nebulous = {
  id: 'nebulous-dream',
  rules: [
    { id: 'odd', trigger: { type: 'turn_parity', parity: 'odd' }, stats: { finalDamagePct: 20 } },
    { id: 'even', trigger: { type: 'turn_parity', parity: 'even' }, stats: { finalDamagePct: -10 } }
  ]
};

test('turn parity trigger distinguishes odd and even turns', () => {
  assert.equal(passiveTriggerMatches({ type: 'turn_parity', parity: 'odd' }, { turn: 1 }), true);
  assert.equal(passiveTriggerMatches({ type: 'turn_parity', parity: 'odd' }, { turn: 2 }), false);
  assert.equal(passiveTriggerMatches({ type: 'turn_parity', parity: 'even' }, { turn: 2 }), true);
});

test('Nebulous passive applies +20 final damage on odd and -10 on even turns', () => {
  assert.equal(applyPassiveModifiers({}, [nebulous], { turn: 1 }).stats.finalDamagePct, 20);
  assert.equal(applyPassiveModifiers({}, [nebulous], { turn: 2 }).stats.finalDamagePct, -10);
  assert.equal(applyPassiveModifiers({}, [nebulous], { turn: 3 }).stats.finalDamagePct, 20);
});

test('context triggers report missing scenario inputs instead of silently choosing a branch', () => {
  const state = passiveTriggerState({ type: 'context_equals', key: 'enemyAdjacent', value: false }, { turn: 1 });
  assert.equal(state.resolved, false);
  assert.deepEqual(state.missingKeys, ['enemyAdjacent']);
});

test('an explicitly ignored contextual passive keeps base item stats and creates no unresolved context', () => {
  const passive = {
    id: 'deep-purple',
    rules: [{ trigger: { type: 'always' }, scaledStats: [{ stat: 'finalDamagePct', contextKey: 'pourpreStacks', multiplier: 1, min: 0, max: 10 }] }]
  };
  const result = applyPassiveModifiers({ power: 80 }, [passive], { turn: 1, ignoredPassiveIds: ['deep-purple'] });
  assert.equal(result.stats.power, 80);
  assert.equal(result.stats.finalDamagePct, undefined);
  assert.deepEqual(result.unresolved, []);
  assert.deepEqual(result.ignored, [{ passiveId: 'deep-purple' }]);
});

test('scaled passive stats clamp context-provided stacks', () => {
  const passive = { id: 'purple', rules: [{ trigger: { type: 'always' }, scaledStats: [{ stat: 'finalDamagePct', contextKey: 'stacks', multiplier: 1, min: 0, max: 10 }] }] };
  assert.equal(applyPassiveModifiers({}, [passive], { turn: 1, stacks: 7 }).stats.finalDamagePct, 7);
  assert.equal(applyPassiveModifiers({}, [passive], { turn: 1, stacks: 99 }).stats.finalDamagePct, 10);
  assert.deepEqual(applyPassiveModifiers({}, [passive], { turn: 1 }).unresolved[0].missingKeys, ['stacks']);
});

test('turn cycle supports deterministic rotating item passives', () => {
  assert.equal(passiveTriggerMatches({ type: 'turn_cycle', length: 4, position: 1 }, { turn: 1 }), true);
  assert.equal(passiveTriggerMatches({ type: 'turn_cycle', length: 4, position: 1 }, { turn: 5 }), true);
  assert.equal(passiveTriggerMatches({ type: 'turn_cycle', length: 4, position: 2 }, { turn: 1 }), false);
});
