import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SpellSemanticCertificationStatus,
  certifiedPlannerSpellEligibility,
  spellEffectSemanticFromCombatEffect
} from '../js/combat/spell-effect-semantic.js';
import {
  combatCastEligibility,
  createCombatState,
  recordCombatCast
} from '../js/combat/state.js';

function recordMany(state, spellId, targetId, count) {
  let next = state;
  for (let index = 0; index < count; index += 1) {
    next = recordCombatCast(next, { spellId, targetId });
  }
  return next;
}

test('perTurn=0 means no explicit per-turn cast limit', () => {
  const state = recordMany(createCombatState({ baseAp: 12 }), 'repeatable', 'enemy-a', 4);
  assert.equal(combatCastEligibility(state, {
    spellId: 'repeatable',
    targetId: 'enemy-a',
    castLimit: { perTurn: 0 }
  }).eligible, true);
});

test('maxCastPerTurn=0 means no explicit per-turn cast limit', () => {
  const state = recordMany(createCombatState({ baseAp: 12 }), 'legacy-repeatable', 'enemy-a', 4);
  assert.equal(combatCastEligibility(state, {
    spellId: 'legacy-repeatable',
    targetId: 'enemy-a',
    castLimit: { maxCastPerTurn: 0 }
  }).eligible, true);
});

test('perTarget=0 adds no artificial one-cast target limit and inherits the per-turn limit', () => {
  let state = recordMany(createCombatState({ baseAp: 12 }), 'target-repeatable', 'enemy-a', 2);
  assert.equal(combatCastEligibility(state, {
    spellId: 'target-repeatable',
    targetId: 'enemy-a',
    castLimit: { perTurn: 3, perTarget: 0 }
  }).eligible, true);

  state = recordCombatCast(state, { spellId: 'target-repeatable', targetId: 'enemy-a' });
  assert.equal(combatCastEligibility(state, {
    spellId: 'target-repeatable',
    targetId: 'enemy-b',
    castLimit: { perTurn: 3, perTarget: 0 }
  }).reason, 'CAST_LIMIT_TURN');
});

test('positive per-turn and per-target cast limits remain enforced', () => {
  let state = recordCombatCast(createCombatState({ baseAp: 12 }), {
    spellId: 'limited',
    targetId: 'enemy-a'
  });
  assert.equal(combatCastEligibility(state, {
    spellId: 'limited',
    targetId: 'enemy-a',
    castLimit: { perTurn: 2, perTarget: 1 }
  }).reason, 'CAST_LIMIT_TARGET');
  assert.equal(combatCastEligibility(state, {
    spellId: 'limited',
    targetId: 'enemy-b',
    castLimit: { perTurn: 2, perTarget: 1 }
  }).eligible, true);

  state = recordCombatCast(state, { spellId: 'limited', targetId: 'enemy-b' });
  assert.equal(combatCastEligibility(state, {
    spellId: 'limited',
    targetId: 'enemy-c',
    castLimit: { perTurn: 2, perTarget: 1 }
  }).reason, 'CAST_LIMIT_TURN');

  const once = recordCombatCast(createCombatState({ baseAp: 12 }), {
    spellId: 'once',
    targetId: 'enemy-a'
  });
  assert.equal(combatCastEligibility(once, {
    spellId: 'once',
    targetId: 'enemy-b',
    castLimit: { perTurn: 1 }
  }).reason, 'CAST_LIMIT_TURN');
});

test('supported runtime effects do not certify a spell when source semantics are unresolved', () => {
  const runtimeDamage = spellEffectSemanticFromCombatEffect({
    type: 'Damage',
    id: 'known-runtime-damage',
    min: 20,
    max: 24
  });

  const unresolved = certifiedPlannerSpellEligibility({
    effects: [runtimeDamage],
    sourceCertification: {
      sourceComplete: false,
      sourceSemanticStatus: SpellSemanticCertificationStatus.UNRESOLVED
    }
  });

  assert.equal(runtimeDamage.status, 'SUPPORTED');
  assert.equal(unresolved.effectSupported, true);
  assert.equal(unresolved.spellSemanticallyCertified, false);
  assert.equal(unresolved.eligible, false);
  assert.deepEqual(unresolved.reasons, ['SOURCE_SEMANTICS_UNRESOLVED']);

  const noProof = certifiedPlannerSpellEligibility({ effects: [runtimeDamage] });
  assert.equal(noProof.eligible, false, 'absence of source completeness proof must be conservative');
});

test('supported runtime effects plus explicit complete source certification are planner-eligible', () => {
  const runtimeDamage = spellEffectSemanticFromCombatEffect({
    type: 'Damage',
    id: 'known-runtime-damage',
    min: 20,
    max: 24
  });

  const certified = certifiedPlannerSpellEligibility({
    effects: [runtimeDamage],
    sourceCertification: {
      sourceComplete: true,
      sourceSemanticStatus: SpellSemanticCertificationStatus.CERTIFIED
    }
  });

  assert.equal(certified.effectSupported, true);
  assert.equal(certified.spellSemanticallyCertified, true);
  assert.equal(certified.eligible, true);
  assert.deepEqual(certified.reasons, []);
});
