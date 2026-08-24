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

test('extracts a generic fixed damage buff like Furia', () => {
  const result = extractDeterministicCombatModifiers(
    [effect(5000, 40, { duration: 2 })],
    registry('#1{{~1~2 à }}#2 Dommages'),
    { minRange: 0 }
  );
  assert.equal(result.modifiers.length, 1);
  assert.deepEqual(result.modifiers[0].stats, { damage: 40 });
});

test('extracts temporary melee and ranged damage buffs from class spells', () => {
  const melee = extractDeterministicCombatModifiers(
    [effect(5000, 10, { duration: 2 })],
    registry('#1% Dommages mêlée'),
    { minRange: 0 }
  );
  assert.deepEqual(melee.modifiers[0].stats, { meleeDamagePct: 10 });

  const ranged = extractDeterministicCombatModifiers(
    [effect(5001, 10, { duration: 2 })],
    registry('#1% Dommages distance', 5001),
    { minRange: 0 }
  );
  assert.deepEqual(ranged.modifiers[0].stats, { rangedDamagePct: 10 });
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

test('recognizes Ankama formatted leading minus as a malus', () => {
  const result = extractDeterministicCombatModifiers(
    [effect(5000, 100)],
    registry('-#1{{~1~2 à -}}#2 Puissance'),
    { minRange: 0 }
  );
  assert.equal(result.modifiers.length, 0);
  assert.equal(result.ignored[0].reason, 'negative');
});

test('recognizes an Ankama minus embedded after a template separator', () => {
  const result = extractDeterministicCombatModifiers(
    [effect(5000, 13290, { diceNum: 13290, diceSide: 1 })],
    registry('#1 : -#3 PA'),
    { minRange: 0 }
  );
  assert.equal(result.modifiers.length, 0);
  assert.equal(result.ignored[0].reason, 'negative');
});

test('does not confuse resistance Critique with a Crit buff', () => {
  const result = extractDeterministicCombatModifiers(
    [effect(5000, 30)],
    registry('#1 Résistance Critique'),
    { minRange: 0 }
  );
  assert.equal(result.modifiers.length, 0);
});

test('never reinterprets a direct elemental hit as a temporary flat-damage buff', () => {
  const direct = effect(99, 30, { duration: 0, diceNum: 30, value: 0 });
  const result = extractDeterministicCombatModifiers(
    [direct],
    registry('#1{{~1~2 à }}#2 dommages Feu', 99),
    { minRange: 0 }
  );
  assert.equal(result.modifiers.length, 0);
  assert.equal(result.ignored[0].reason, 'direct-damage');
});

test('an instant stat-looking line is not assumed to be a persistent buff', () => {
  const result = extractDeterministicCombatModifiers(
    [effect(5000, 150, { duration: 0 })],
    registry('#1{{~1~2 à }}#2 Puissance'),
    { minRange: 0 }
  );
  assert.equal(result.modifiers.length, 0);
  assert.equal(result.ignored[0].reason, 'instant-effect');
});

test('does not confuse AP/MP dodge or reduction text with an AP/MP gain', () => {
  const dodge = extractDeterministicCombatModifiers(
    [effect(5000, 20)],
    registry('-#1{{~1~2 à -}}#2 Esquive PM'),
    { minRange: 0 }
  );
  assert.equal(dodge.modifiers.length, 0);
});

test('detects explicit area metadata without assuming every spell is AoE', () => {
  assert.equal(spellAreaHint([{ zoneSize: 2 }]), true);
  assert.equal(spellAreaHint([{ zoneShape: 'C', zoneSize: 0 }]), true);
  assert.equal(spellAreaHint([{ zoneShape: 'P', zoneSize: 0 }]), false);
});
