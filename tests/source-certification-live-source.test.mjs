import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createPlannerSourceCertification,
  sourceBoundScriptOccurrenceIds,
  sourceEffectOccurrenceIds,
  sourceStateReferenceOccurrenceIds,
  validatePlannerSourceCertification
} from '../js/combat/source-certification.js';

function sourceSpell(id, { effects = ['A'], scripts = [], states = [] } = {}) {
  return {
    id,
    effects: effects.map((effectId) => ({ effectId })),
    criticalEffects: [],
    scripts: { bound: scripts.map((scriptId) => ({ scriptId })) },
    stateReferences: states.map((stateId, index) => ({ path: `fixture.state${index}`, ids: [stateId] }))
  };
}

function completeCertification(id, source) {
  return createPlannerSourceCertification({
    spellId: id,
    sourceSpell: source,
    certifiedSemantics: ['damage', 'ap-cost', 'crit', 'range', 'cast-limits', 'cooldown', 'targeting'],
    sourceCoverage: {
      effects: { classifiedIds: sourceEffectOccurrenceIds(source), unresolvedIds: [], ignoredIds: [] },
      scripts: { classifiedIds: sourceBoundScriptOccurrenceIds(source), unresolvedIds: [], ignoredIds: [] },
      states: { classifiedIds: sourceStateReferenceOccurrenceIds(source), unresolvedIds: [], ignoredIds: [] }
    },
    evidence: [{
      source: 'fixture:live-source',
      spellId: id,
      proof: 'Fixture proves spell-level T1 semantics independently from occurrence coverage.',
      semantics: ['damage', 'ap-cost', 'crit', 'range', 'cast-limits', 'cooldown', 'targeting']
    }]
  });
}

test('cross-spell source cannot certify another spell identity', () => {
  const sourceY = sourceSpell('Y');
  const certification = completeCertification('X', sourceY);
  assert.equal(certification.sourceComplete, false);
  const validation = validatePlannerSourceCertification('X', certification, sourceY);
  assert.equal(validation.eligible, false);
  assert.ok(validation.reasons.includes('SOURCE_SPELL_ID_MISMATCH'));
});

test('matching spell identity and live source pass', () => {
  const sourceX = sourceSpell('X');
  const certification = completeCertification('X', sourceX);
  assert.equal(certification.sourceComplete, true);
  assert.equal(validatePlannerSourceCertification('X', certification, sourceX).eligible, true);
});

test('stale certification fails when live source adds an effect', () => {
  const original = sourceSpell('X', { effects: ['A'] });
  const certification = completeCertification('X', original);
  const changed = sourceSpell('X', { effects: ['A', 'B'] });
  const validation = validatePlannerSourceCertification('X', certification, changed);
  assert.equal(validation.eligible, false);
  assert.ok(validation.reasons.includes('SOURCE_FINGERPRINT_MISMATCH'));
  assert.ok(validation.reasons.includes('SOURCE_EFFECT_COVERAGE_SOURCE_MISMATCH'));
});

test('same effects but changed scripts and states invalidate stale certification', () => {
  const original = sourceSpell('X', { effects: ['A'] });
  const certification = completeCertification('X', original);
  const changed = sourceSpell('X', { effects: ['A'], scripts: [77], states: [42] });
  const validation = validatePlannerSourceCertification('X', certification, changed);
  assert.equal(validation.eligible, false);
  assert.ok(validation.reasons.includes('SOURCE_FINGERPRINT_MISMATCH'));
  assert.ok(validation.reasons.includes('SOURCE_SCRIPT_COVERAGE_SOURCE_MISMATCH'));
  assert.ok(validation.reasons.includes('SOURCE_STATE_COVERAGE_SOURCE_MISMATCH'));
});

test('self-consistent serialized certification is rejected without live source', () => {
  const sourceX = sourceSpell('X');
  const certification = completeCertification('X', sourceX);
  const validation = validatePlannerSourceCertification('X', certification);
  assert.equal(validation.eligible, false);
  assert.ok(validation.reasons.includes('SOURCE_TRUTH_MISSING'));
});

test('live source identity is part of fingerprint', () => {
  const sourceX = sourceSpell('X', { effects: ['A'], scripts: [77], states: [42] });
  const certification = completeCertification('X', sourceX);
  const copiedUniverseDifferentIdentity = sourceSpell('Y', { effects: ['A'], scripts: [77], states: [42] });
  const validation = validatePlannerSourceCertification('X', certification, copiedUniverseDifferentIdentity);
  assert.equal(validation.eligible, false);
  assert.ok(validation.reasons.includes('SOURCE_SPELL_ID_MISMATCH'));
  assert.ok(validation.reasons.includes('SOURCE_FINGERPRINT_MISMATCH'));
});
