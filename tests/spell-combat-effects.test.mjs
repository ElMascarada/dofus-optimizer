import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractDeterministicCombatModifiers,
  spellAreaHint
} from '../js/spell-combat-effects.js';

function registry(description, id = 5000) {
  return new Map([[id, { id, description, normalizedDescription: description.toLowerCase() }]]);
}

function effect(effectId = 5000, value = 200, extra = {}) {
  return {
    effectId,
    value,
    diceNum: 0,
    diceSide: 0,
    triggers: 'I',
    duration: 2,
    delay: 0,
    random: 0,
    targetMask: 'C',
    ...extra
  };
}

test('extracts a deterministic Puissance self buff with its duration', () => {
  const result = extractDeterministicCombatModifiers(
    [effect(5000, 200)],
    registry('Augmente la Puissance de 200'),
    { minRange: 0 }
  );

  assert.equal(result.modifiers.length, 1);
  assert.equal(result.modifiers[0].scope, 'self');
  assert.deepEqual(result.modifiers[0].stats, { power: 200 });
  assert.equal(result.modifiers[0].durationTurns, 2);
});

test('extracts a target vulnerability like Bond or Massacre as final damage taken', () => {
  const result = extractDeterministicCombatModifiers(
    [effect(5000, 15, { targetMask: 'A', duration: 2 })],
    registry('Augmente les dommages subis de 15%'),
    { minRange: 1 }
  );

  assert.equal(result.modifiers.length, 1);
  assert.equal(result.modifiers[0].scope, 'target');
  assert.deepEqual(result.modifiers[0].stats, { finalDamageTakenPct: 15 });
  assert.equal(result.modifiers[0].durationTurns, 2);
});

test('normalizes a x115% damage-taken representation to +15%', () => {
  const result = extractDeterministicCombatModifiers(
    [effect(5000, 115, { targetMask: 'A' })],
    registry('Dommages subis : 115%'),
    { minRange: 1 }
  );
  assert.deepEqual(result.modifiers[0].stats, { finalDamageTakenPct: 15 });
});

test('does not turn a negative Power effect into a player buff', () => {
  const result = extractDeterministicCombatModifiers(
    [effect(5000, 100)],
    registry('Retire 100 Puissance'),
    { minRange: 0 }
  );
  assert.equal(result.modifiers.length, 0);
  assert.equal(result.ignored[0].reason, 'negative');
});

test('detects explicit area metadata without assuming every spell is AoE', () => {
  assert.equal(spellAreaHint([{ zoneSize: 2 }]), true);
  assert.equal(spellAreaHint([{ zoneShape: 'C', zoneSize: 0 }]), true);
  assert.equal(spellAreaHint([{ zoneShape: 'P', zoneSize: 0 }]), false);
});
