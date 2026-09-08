import {
  SpellSemanticCertificationStatus
} from './spell-effect-semantic.js';

export const PlannerSourceCertificationSchemaVersion = 2;

const SOURCE_COVERAGE_KINDS = Object.freeze(['effects', 'scripts', 'states']);

function cloneValue(value) {
  if (value === undefined || value === null || typeof value !== 'object') return value;
  return structuredClone(value);
}

function asSortedStrings(values = []) {
  return [...new Set((values || []).map((value) => String(value ?? '').trim()).filter(Boolean))].sort();
}

function occurrenceValue(value) {
  if (value === undefined || value === null || value === '') return 'unknown';
  return String(value);
}

function sourceSpellIdentity(sourceSpell = null) {
  if (!sourceSpell || typeof sourceSpell !== 'object') return '';
  if (sourceSpell.id === undefined || sourceSpell.id === null) return '';
  return String(sourceSpell.id).trim();
}

export function sourceEffectOccurrenceIds(sourceSpell = {}) {
  return [
    ...(sourceSpell.effects || []).map((effect, index) => `normal:${index}:${occurrenceValue(effect?.effectId)}`),
    ...(sourceSpell.criticalEffects || []).map((effect, index) => `critical:${index}:${occurrenceValue(effect?.effectId)}`)
  ];
}

export function sourceBoundScriptOccurrenceIds(sourceSpell = {}) {
  return (sourceSpell.scripts?.bound || [])
    .map((usage, index) => `bound:${index}:${occurrenceValue(usage?.scriptId)}`);
}

export function sourceStateReferenceOccurrenceIds(sourceSpell = {}) {
  return (sourceSpell.stateReferences || []).flatMap((reference, referenceIndex) => {
    const ids = Array.isArray(reference?.ids) ? reference.ids : [];
    if (!ids.length) return [`state:${referenceIndex}:0:unknown`];
    return ids.map((stateId, stateIndex) => `state:${referenceIndex}:${stateIndex}:${occurrenceValue(stateId)}`);
  });
}

function fingerprintFromActual(sourceSpellId, actual = {}) {
  return JSON.stringify({
    spellId: String(sourceSpellId || ''),
    effects: asSortedStrings(actual.effects || []),
    scripts: asSortedStrings(actual.scripts || []),
    states: asSortedStrings(actual.states || [])
  });
}

export function sourceCoverageFingerprint(sourceSpell = null) {
  if (!sourceSpell || typeof sourceSpell !== 'object') return '';
  return fingerprintFromActual(sourceSpellIdentity(sourceSpell), {
    effects: sourceEffectOccurrenceIds(sourceSpell),
    scripts: sourceBoundScriptOccurrenceIds(sourceSpell),
    states: sourceStateReferenceOccurrenceIds(sourceSpell)
  });
}

function actualSourceCoverage(sourceSpell = null) {
  if (!sourceSpell || typeof sourceSpell !== 'object') return null;
  return {
    effects: asSortedStrings(sourceEffectOccurrenceIds(sourceSpell)),
    scripts: asSortedStrings(sourceBoundScriptOccurrenceIds(sourceSpell)),
    states: asSortedStrings(sourceStateReferenceOccurrenceIds(sourceSpell))
  };
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

function normalizeIgnoredSourceEntries(entries = []) {
  return (entries || []).map((entry) => ({
    sourceOccurrenceId: String(entry?.sourceOccurrenceId || entry?.sourceEffectId || entry?.id || '').trim(),
    justification: String(entry?.justification || '').trim(),
    certifiedIrrelevantToT1: entry?.certifiedIrrelevantToT1 === true
  })).filter((entry) => entry.sourceOccurrenceId || entry.justification || entry.certifiedIrrelevantToT1);
}

function normalizeClassificationBucket(coverage = null) {
  const value = coverage && typeof coverage === 'object' ? coverage : {};
  return {
    classifiedIds: asSortedStrings(value.classifiedIds || value.classifiedEffectIds || []),
    unresolvedIds: asSortedStrings(value.unresolvedIds || value.unresolvedEffectIds || []),
    ignoredIds: asSortedStrings(value.ignoredIds || value.ignoredEffectIds || [])
  };
}

function normalizeDeclaredSourceCoverage(sourceCoverage = null) {
  const value = sourceCoverage && typeof sourceCoverage === 'object' ? sourceCoverage : {};
  return Object.fromEntries(SOURCE_COVERAGE_KINDS.map((kind) => [
    kind,
    normalizeClassificationBucket(value[kind])
  ]));
}

function normalizeIgnoredSource(ignoredSource = null) {
  const value = ignoredSource && typeof ignoredSource === 'object' ? ignoredSource : {};
  return Object.fromEntries(SOURCE_COVERAGE_KINDS.map((kind) => [
    kind,
    normalizeIgnoredSourceEntries(value[kind] || [])
  ]));
}

function coverageAnalysis(actualIds = [], declaredCoverage = null, ignoredEntries = []) {
  const normalized = normalizeClassificationBucket(declaredCoverage);
  const actual = asSortedStrings(actualIds);
  const buckets = [normalized.classifiedIds, normalized.unresolvedIds, normalized.ignoredIds];
  const seen = new Map();

  for (const bucket of buckets) {
    for (const id of bucket) seen.set(id, (seen.get(id) || 0) + 1);
  }

  const actualSet = new Set(actual);
  const union = new Set(buckets.flat());
  const overlaps = [...seen.entries()]
    .filter(([, count]) => count > 1)
    .map(([id]) => id)
    .sort();
  const missingIds = [...actualSet].filter((id) => !union.has(id)).sort();
  const extraIds = [...union].filter((id) => !actualSet.has(id)).sort();
  const ignoredProofById = new Map(normalizeIgnoredSourceEntries(ignoredEntries)
    .map((entry) => [entry.sourceOccurrenceId, entry]));
  const ignoredCertified = normalized.ignoredIds.every((id) => {
    const proof = ignoredProofById.get(id);
    return proof
      && proof.justification.length > 0
      && proof.certifiedIrrelevantToT1 === true;
  });

  return {
    actualIds: actual,
    ...normalized,
    complete: overlaps.length === 0
      && missingIds.length === 0
      && extraIds.length === 0
      && normalized.unresolvedIds.length === 0
      && ignoredCertified,
    overlaps,
    missingIds,
    extraIds,
    ignoredCertified
  };
}

function sourceCoverageAnalysis(sourceSpell = null, sourceCoverage = null, ignoredSource = null) {
  const actual = actualSourceCoverage(sourceSpell);
  const declared = normalizeDeclaredSourceCoverage(sourceCoverage);
  const ignored = normalizeIgnoredSource(ignoredSource);

  if (!actual) {
    return {
      sourceBound: false,
      sourceSpellId: '',
      fingerprint: '',
      coverage: Object.fromEntries(SOURCE_COVERAGE_KINDS.map((kind) => [
        kind,
        coverageAnalysis([], declared[kind], ignored[kind])
      ])),
      ignored
    };
  }

  return {
    sourceBound: true,
    sourceSpellId: sourceSpellIdentity(sourceSpell),
    fingerprint: sourceCoverageFingerprint(sourceSpell),
    coverage: Object.fromEntries(SOURCE_COVERAGE_KINDS.map((kind) => [
      kind,
      coverageAnalysis(actual[kind], declared[kind], ignored[kind])
    ])),
    ignored
  };
}

function freezeCoverage(coverage = {}) {
  return Object.freeze(Object.fromEntries(SOURCE_COVERAGE_KINDS.map((kind) => {
    const entry = coverage[kind] || coverageAnalysis();
    return [kind, Object.freeze({
      actualIds: Object.freeze([...entry.actualIds]),
      classifiedIds: Object.freeze([...entry.classifiedIds]),
      unresolvedIds: Object.freeze([...entry.unresolvedIds]),
      ignoredIds: Object.freeze([...entry.ignoredIds])
    })];
  })));
}

function freezeIgnoredSource(ignored = {}) {
  return Object.freeze(Object.fromEntries(SOURCE_COVERAGE_KINDS.map((kind) => [
    kind,
    Object.freeze((ignored[kind] || []).map((entry) => Object.freeze(entry)))
  ])));
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

function storedCoverageAnalysis(certification = {}) {
  const sourceCoverage = certification.sourceCoverage && typeof certification.sourceCoverage === 'object'
    ? certification.sourceCoverage
    : {};
  const ignoredSource = normalizeIgnoredSource(certification.ignoredSource);
  return {
    sourceBound: certification.sourceBound === true,
    sourceSpellId: String(certification.sourceSpellId || ''),
    fingerprint: String(certification.sourceFingerprint || ''),
    coverage: Object.fromEntries(SOURCE_COVERAGE_KINDS.map((kind) => {
      const stored = sourceCoverage[kind] && typeof sourceCoverage[kind] === 'object'
        ? sourceCoverage[kind]
        : {};
      return [kind, coverageAnalysis(
        stored.actualIds || [],
        stored,
        ignoredSource[kind]
      )];
    }))
  };
}

function sourceCoverageIsComplete(analysis) {
  return analysis.sourceBound === true
    && analysis.fingerprint.length > 0
    && SOURCE_COVERAGE_KINDS.every((kind) => analysis.coverage[kind].complete);
}

function appendCoverageReasons(reasons, analysis) {
  const configs = {
    effects: {
      prefix: 'SOURCE_EFFECT',
      unresolved: 'SOURCE_EFFECTS_UNRESOLVED',
      ignored: 'IGNORED_SOURCE_EFFECTS_UNCERTIFIED'
    },
    scripts: {
      prefix: 'SOURCE_SCRIPT',
      unresolved: 'SOURCE_SCRIPTS_UNRESOLVED',
      ignored: 'IGNORED_SOURCE_SCRIPTS_UNCERTIFIED'
    },
    states: {
      prefix: 'SOURCE_STATE',
      unresolved: 'SOURCE_STATES_UNRESOLVED',
      ignored: 'IGNORED_SOURCE_STATES_UNCERTIFIED'
    }
  };

  for (const kind of SOURCE_COVERAGE_KINDS) {
    const entry = analysis.coverage[kind];
    const config = configs[kind];
    if (entry.missingIds.length) reasons.push(`${config.prefix}_COVERAGE_INCOMPLETE`);
    if (entry.extraIds.length) reasons.push(`${config.prefix}_COVERAGE_EXTRA`);
    if (entry.overlaps.length) reasons.push(`${config.prefix}_COVERAGE_OVERLAP`);
    if (entry.unresolvedIds.length) reasons.push(config.unresolved);
    if (!entry.ignoredCertified) reasons.push(config.ignored);
  }
}

function coverageIdsEqual(left = [], right = []) {
  return JSON.stringify(asSortedStrings(left)) === JSON.stringify(asSortedStrings(right));
}

function appendLiveSourceMismatchReasons(reasons, storedAnalysis, liveAnalysis) {
  const configs = {
    effects: 'SOURCE_EFFECT_COVERAGE_SOURCE_MISMATCH',
    scripts: 'SOURCE_SCRIPT_COVERAGE_SOURCE_MISMATCH',
    states: 'SOURCE_STATE_COVERAGE_SOURCE_MISMATCH'
  };
  for (const kind of SOURCE_COVERAGE_KINDS) {
    if (!coverageIdsEqual(
      storedAnalysis.coverage[kind].actualIds,
      liveAnalysis.coverage[kind].actualIds
    )) reasons.push(configs[kind]);
  }
}

export function createPlannerSourceCertification({
  spellId,
  sourceSpell = null,
  evidence = [],
  certifiedSemantics = [],
  unresolvedSemantics = [],
  ignoredSemantics = [],
  sourceCoverage = null,
  ignoredSource = null,
  criticalSemantics = 'IMMEDIATE_DAMAGE_ONLY'
} = {}) {
  const id = String(spellId || '').trim();
  if (!id) throw new Error('Planner source certification requires a spellId.');

  const normalizedEvidence = normalizeEvidence(evidence);
  const normalizedCertified = asSortedStrings(certifiedSemantics);
  const normalizedUnresolved = asSortedStrings(unresolvedSemantics);
  const normalizedIgnored = normalizeIgnoredSemantics(ignoredSemantics);
  const coverageAnalysis = sourceCoverageAnalysis(sourceSpell, sourceCoverage, ignoredSource);
  const sourceSpellId = sourceSpellIdentity(sourceSpell);
  const sourceIdentityMatches = coverageAnalysis.sourceBound && sourceSpellId === id;
  const reviewableEvidence = normalizedEvidence.length > 0
    && normalizedEvidence.every((entry) => evidenceIsReviewable(entry, id));
  const evidenceCoverageComplete = evidenceCoversCertifiedSemantics(normalizedEvidence, normalizedCertified);
  const ignoredAreCertified = normalizedIgnored.every(ignoredSemanticIsCertified);
  const sourceComplete = sourceIdentityMatches
    && reviewableEvidence
    && evidenceCoverageComplete
    && normalizedCertified.length > 0
    && normalizedUnresolved.length === 0
    && ignoredAreCertified
    && sourceCoverageIsComplete(coverageAnalysis);

  return Object.freeze({
    schemaVersion: PlannerSourceCertificationSchemaVersion,
    spellId: id,
    sourceSpellId: sourceSpellId || null,
    sourceBound: coverageAnalysis.sourceBound,
    sourceFingerprint: coverageAnalysis.fingerprint,
    sourceComplete,
    sourceSemanticStatus: sourceComplete
      ? SpellSemanticCertificationStatus.CERTIFIED
      : SpellSemanticCertificationStatus.UNRESOLVED,
    criticalSemantics: String(criticalSemantics || '').trim(),
    certifiedSemantics: normalizedCertified,
    unresolvedSemantics: normalizedUnresolved,
    ignoredSemantics: normalizedIgnored.map((entry) => Object.freeze(entry)),
    sourceCoverage: freezeCoverage(coverageAnalysis.coverage),
    ignoredSource: freezeIgnoredSource(coverageAnalysis.ignored),
    evidence: normalizedEvidence.map((entry) => Object.freeze(entry))
  });
}

export function validatePlannerSourceCertification(spellId, sourceCertification = null, sourceSpell = null) {
  const id = String(spellId || '').trim();
  const certification = cloneValue(sourceCertification || {});
  const reasons = [];

  if (certification.schemaVersion !== PlannerSourceCertificationSchemaVersion) {
    reasons.push('SOURCE_CERTIFICATION_SCHEMA_MISSING');
  }
  if (!id || String(certification.spellId || '') !== id) reasons.push('SOURCE_CERTIFICATION_SPELL_ID_MISMATCH');
  if (!certification.sourceSpellId || String(certification.sourceSpellId) !== id) {
    reasons.push('SOURCE_SPELL_ID_MISMATCH');
  }

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

  const storedAnalysis = storedCoverageAnalysis(certification);
  if (!storedAnalysis.sourceBound || !storedAnalysis.fingerprint) {
    reasons.push('SOURCE_TRUTH_MISSING');
  } else {
    const expectedStoredFingerprint = fingerprintFromActual(
      storedAnalysis.sourceSpellId,
      Object.fromEntries(SOURCE_COVERAGE_KINDS.map((kind) => [
        kind,
        storedAnalysis.coverage[kind].actualIds
      ]))
    );
    if (storedAnalysis.fingerprint !== expectedStoredFingerprint) reasons.push('SOURCE_FINGERPRINT_MISMATCH');
  }
  appendCoverageReasons(reasons, storedAnalysis);

  if (!sourceSpell || typeof sourceSpell !== 'object') {
    reasons.push('SOURCE_TRUTH_MISSING');
  } else {
    const liveSourceSpellId = sourceSpellIdentity(sourceSpell);
    if (!liveSourceSpellId || liveSourceSpellId !== id) reasons.push('SOURCE_SPELL_ID_MISMATCH');

    const liveAnalysis = sourceCoverageAnalysis(
      sourceSpell,
      certification.sourceCoverage,
      certification.ignoredSource
    );
    if (certification.sourceFingerprint !== liveAnalysis.fingerprint) {
      reasons.push('SOURCE_FINGERPRINT_MISMATCH');
    }
    appendLiveSourceMismatchReasons(reasons, storedAnalysis, liveAnalysis);
    appendCoverageReasons(reasons, liveAnalysis);
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
