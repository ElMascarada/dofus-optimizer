import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPassiveModifiers, passiveTriggerMatches } from '../js/passives.js';

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
