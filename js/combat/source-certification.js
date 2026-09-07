import {
  SpellSemanticCertificationStatus
} from './spell-effect-semantic.js';

export const PlannerSourceCertificationSchemaVersion = 2;

function cloneValue(value) {
  if (value === undefined || value === null || typeof value !== 'object') return value;
  return structuredClone(value);
}

function asSortedStrings(values = []) {
  return [...new Set((values || []).map((value) => String(value || '').trim()).filter(Boolean))].sort();
}

function normalizeEvidence(evidence = []) {
  return (evidence || []).map((entry) => ({
    source: String(entry?.source || '').trim(),
    spellId: String(entry?.spellId || '').trim(),
    proof: String(entry?.proof || '').trim(),
    semantics: asSortedStrings(entry?.semantics || [])
  })).filter((entry) => entry.source || entry.spellId || entry.proof || entry.semantics.length);
}

function normalizeIgnoredSemantics(entries = []) {
  return (entries || []).map((entry) => ({
    semantic: String(entry?.semantic || entry?.id || '').trim(),
    justification: String(entry?.justification || '').trim(),
    certifiedIrrelevantToT1: entry?.certifiedIrrelevantToT1 === true
  }));
}

function normalizeIgnoredSourceEffects(entries = []) {
  return (entries || []).map((entry) => ({
    sourceEffectId: String(entry?.sourceEffectId || entry?.effectId || entry?.id || '').trim(),
    justification: String(entry?.justification || '').trim(),
    certifiedIrrelevantToT1: entry?.certifiedIrrelevantToT1 === true
  })).filter((entry) => entry.sourceEffectId || entry.justification || entry.certifiedIrrelevantToT1);
}

function normalizeSourceEffectCoverage(coverage = null) {
  if (!coverage || typeof coverage !== 'object') return null;
  return {
    sourceEffectIds: asSortedStrings(coverage.sourceEffectIds || []),
    classifiedEffectIds: asSortedStrings(coverage.classifiedEffectIds || []),
    unresolvedEffectIds: asSortedStrings(coverage.unresolvedEffectIds || []),
    ignoredEffectIds: asSortedStrings(coverage.ignoredEffectIds || [])
  };
}

function sourceEffectCoverageAnalysis(coverage = null, ignoredSourceEffects = []) {
  const normalized = normalizeSourceEffectCoverage(coverage);
  if (!normalized || !normalized.sourceEffectIds.length) {
    return {
      coverage: normalized,
      complete: false,
      overlaps: [],
      missingEffectIds: [],
      extraEffectIds: []
    };
  }

  const buckets = [
    normalized.classifiedEffectIds,
    normalized.unresolvedEffectIds,
    normalized.ignoredEffectIds
  ];
  const seen = new Map();
  for (const bucket of buckets) {
    for (const id of bucket) seen.set(id, (seen.get(id) || 0) + 1);
  }

  const source = new Set(normalized.sourceEffectIds);
  const union = new Set(buckets.flat());
  const overlaps = [...seen.entries()].filter(([, count]) => count > 1).map(([id]) => id).sort();
  const missingEffectIds = [...source].filter((id) => !union.has(id)).sort();
  const extraEffectIds = [...union].filter((id) => !source.has(id)).sort();
  const ignoredProofById = new Map(normalizeIgnoredSourceEffects(ignoredSourceEffects)
    .map((entry) => [entry.sourceEffectId, entry]));
  const ignoredCertified = normalized.ignoredEffectIds.every((id) => {
    const proof = ignoredProofById.get(id);
    return proof
      && proof.justification.length > 0
      && proof.certifiedIrrelevantToT1 === true;
  });

  return {
    coverage: normalized,
    complete: overlaps.length === 0
      && missingEffectIds.length === 0
      && extraEffectIds.length === 0
      && normalized.unresolvedEffectIds.length === 0
      && ignoredCertified,
    overlaps,
    missingEffectIds,
    extraEffectIds,
    ignoredCertified
  };
}

function evidenceIsReviewable(entry, spellId) {
  return entry.source.length > 0
    && entry.spellId === spellId
    && entry.proof.length > 0
    && entry.semantics.length > 0;
}

function evidenceCoversCertifiedSemantics(evidence, certifiedSemantics) {
  const covered = new Set(evidence.flatMap((entry) => entry.semantics || []));
  return certifiedSemantics.every((semantic) => covered.has(semantic));
}

function ignoredSemanticIsCertified(entry) {
  return entry.semantic.length > 0
    && entry.justification.length > 0
    && entry.certifiedIrrelevantToT1 === true;
}

export function createPlannerSourceCertification({
  spellId,
  evidence = [],
  certifiedSemantics = [],
  unresolvedSemantics = [],
  ignoredSemantics = [],
  sourceEffectCoverage = null,
  ignoredSourceEffects = [],
  criticalSemantics = 'IMMEDIATE_DAMAGE_ONLY'
} = {}) {
  const id = String(spellId || '').trim();
  if (!id) throw new Error('Planner source certification requires a spellId.');

  const normalizedEvidence = normalizeEvidence(evidence);
  const normalizedCertified = asSortedStrings(certifiedSemantics);
  const normalizedUnresolved = asSortedStrings(unresolvedSemantics);
  const normalizedIgnored = normalizeIgnoredSemantics(ignoredSemantics);
  const normalizedIgnoredSourceEffects = normalizeIgnoredSourceEffects(ignoredSourceEffects);
  const coverageAnalysis = sourceEffectCoverageAnalysis(sourceEffectCoverage, normalizedIgnoredSourceEffects);
  const reviewableEvidence = normalizedEvidence.length > 0
    && normalizedEvidence.every((entry) => evidenceIsReviewable(entry, id));
  const evidenceCoverageComplete = evidenceCoversCertifiedSemantics(normalizedEvidence, normalizedCertified);
  const ignoredAreCertified = normalizedIgnored.every(ignoredSemanticIsCertified);
  const sourceComplete = reviewableEvidence
    && evidenceCoverageComplete
    && normalizedCertified.length > 0
    && normalizedUnresolved.length === 0
    && ignoredAreCertified
    && coverageAnalysis.complete;

  return Object.freeze({
    schemaVersion: PlannerSourceCertificationSchemaVersion,
    spellId: id,
    sourceComplete,
    sourceSemanticStatus: sourceComplete
      ? SpellSemanticCertificationStatus.CERTIFIED
      : SpellSemanticCertificationStatus.UNRESOLVED,
    criticalSemantics: String(criticalSemantics || '').trim(),
    certifiedSemantics: normalizedCertified,
    unresolvedSemantics: normalizedUnresolved,
    ignoredSemantics: normalizedIgnored.map((entry) => Object.freeze(entry)),
    sourceEffectCoverage: coverageAnalysis.coverage
      ? Object.freeze({
          sourceEffectIds: Object.freeze([...coverageAnalysis.coverage.sourceEffectIds]),
          classifiedEffectIds: Object.freeze([...coverageAnalysis.coverage.classifiedEffectIds]),
          unresolvedEffectIds: Object.freeze([...coverageAnalysis.coverage.unresolvedEffectIds]),
          ignoredEffectIds: Object.freeze([...coverageAnalysis.coverage.ignoredEffectIds])
        })
      : null,
    ignoredSourceEffects: normalizedIgnoredSourceEffects.map((entry) => Object.freeze(entry)),
    evidence: normalizedEvidence.map((entry) => Object.freeze(entry))
  });
}

export function validatePlannerSourceCertification(spellId, sourceCertification = null) {
  const id = String(spellId || '').trim();
  const certification = cloneValue(sourceCertification || {});
  const reasons = [];

  if (certification.schemaVersion !== PlannerSourceCertificationSchemaVersion) {
    reasons.push('SOURCE_CERTIFICATION_SCHEMA_MISSING');
  }
  if (!id || String(certification.spellId || '') !== id) reasons.push('SOURCE_CERTIFICATION_SPELL_ID_MISMATCH');

  const evidence = normalizeEvidence(certification.evidence || []);
  if (!evidence.length || !evidence.every((entry) => evidenceIsReviewable(entry, id))) {
    reasons.push('SOURCE_PROOF_MISSING');
  }

  const certifiedSemantics = asSortedStrings(certification.certifiedSemantics || []);
  if (!certifiedSemantics.length) reasons.push('CERTIFIED_SEMANTICS_MISSING');
  if (certifiedSemantics.length && !evidenceCoversCertifiedSemantics(evidence, certifiedSemantics)) {
    reasons.push('SOURCE_PROOF_INCOMPLETE');
  }

  const unresolvedSemantics = asSortedStrings(certification.unresolvedSemantics || []);
  if (unresolvedSemantics.length) reasons.push('SOURCE_SEMANTICS_UNRESOLVED');

  const ignoredSemantics = normalizeIgnoredSemantics(certification.ignoredSemantics || []);
  if (!ignoredSemantics.every(ignoredSemanticIsCertified)) reasons.push('IGNORED_SEMANTICS_UNCERTIFIED');

  const coverageAnalysis = sourceEffectCoverageAnalysis(
    certification.sourceEffectCoverage,
    certification.ignoredSourceEffects || []
  );
  if (!coverageAnalysis.coverage || !coverageAnalysis.coverage.sourceEffectIds.length) {
    reasons.push('SOURCE_EFFECT_COVERAGE_MISSING');
  } else {
    if (coverageAnalysis.missingEffectIds.length) reasons.push('SOURCE_EFFECT_COVERAGE_INCOMPLETE');
    if (coverageAnalysis.extraEffectIds.length) reasons.push('SOURCE_EFFECT_COVERAGE_EXTRA');
    if (coverageAnalysis.overlaps.length) reasons.push('SOURCE_EFFECT_COVERAGE_OVERLAP');
    if (coverageAnalysis.coverage.unresolvedEffectIds.length) reasons.push('SOURCE_EFFECTS_UNRESOLVED');
    if (!coverageAnalysis.ignoredCertified) reasons.push('IGNORED_SOURCE_EFFECTS_UNCERTIFIED');
  }

  if (certification.sourceComplete !== true
    || certification.sourceSemanticStatus !== SpellSemanticCertificationStatus.CERTIFIED) {
    reasons.push('SOURCE_CERTIFICATION_INCOMPLETE');
  }

  if (String(certification.criticalSemantics || '') !== 'IMMEDIATE_DAMAGE_ONLY') {
    reasons.push('CRITICAL_STATE_SEMANTICS_UNCERTIFIED');
  }

  return {
    eligible: reasons.length === 0,
    reasons: [...new Set(reasons)],
    sourceCertification: certification
  };
}
