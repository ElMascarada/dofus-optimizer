import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeSpellSourceTruthWithMetadata } from '../js/dofus-spell-source-semantics.js';
import {
  createPlannerSourceCertification,
  sourceBoundScriptOccurrenceIds,
  sourceEffectOccurrenceIds,
  sourceStateReferenceOccurrenceIds,
  validatePlannerSourceCertification
} from '../js/combat/source-certification.js';

function releasePayload(className, records = []) {
  return {
    references: {
      RefIds: records.map((data) => ({
        type: { class: className },
        data
      }))
    }
  };
}

function makeSourceTruth({
  effectId = 700,
  effectMetadata = true,
  boundScriptId = null,
  scriptMetadata = true
} = {}) {
  const spell = {
    id: 13118,
    nameId: 1001,
    order: 1,
    typeId: 5,
    spellLevels: [501],
    boundScriptUsageData: boundScriptId === null ? [] : [{
      id: 9001,
      order: 3,
      scriptId: boundScriptId,
      criterion: 'fixture',
      targetMask: 'a'
    }]
  };
  const level = {
    id: 501,
    grade: 3,
    minPlayerLevel: 190,
    apCost: 2,
    minRange: 0,
    range: 0,
    maxCastPerTurn: 1,
    maxCastPerTarget: 1,
    minCastInterval: 0,
    criticalHitProbability: 0,
    effects: [{
      effectId,
      order: 4,
      triggers: 'I',
      duration: 2,
      delay: 1,
      targetMask: 'a,A',
      diceNum: 100,
      diceSide: 0,
      value: 0,
      zoneDescr: 'P1',
      random: 0,
      randomGroup: 0,
      group: 0
    }],
    criticalEffect: []
  };
  const effect = {
    id: effectId,
    descriptionId: 2001,
    iconId: 12,
    characteristic: 19,
    category: 2,
    characteristicOperator: '+',
    showInTooltip: true,
    useDice: true,
    forceMinMax: false,
    boost: false,
    active: true,
    oppositeId: 0,
    theoreticalDescriptionId: 2002,
    theoreticalPattern: 1,
    showInSet: false,
    parametersFixed: false,
    bonusType: 1,
    useInFight: true,
    effectPriority: 5,
    effectPowerRate: 1,
    elementId: 0,
    isInPercent: false,
    hideValueInTooltip: false,
    textIconReferenceId: 0,
    effectTriggerDuration: 0,
    actionFiltersId: []
  };

  return normalizeSpellSourceTruthWithMetadata({
    spellsPayload: releasePayload('SpellData', [spell]),
    levelsPayload: releasePayload('SpellLevelData', [level]),
    variantsPayload: releasePayload('SpellVariantData', []),
    breedsPayload: releasePayload('BreedData', [{
      id: 8,
      shortNameId: 1002,
      sortIndex: 1,
      breedSpellsId: [13118]
    }]),
    pairsPayload: releasePayload('SpellPairData', []),
    scriptsPayload: releasePayload('SpellScriptData', boundScriptId !== null && scriptMetadata ? [{
      id: boundScriptId,
      rawParams: '{"fixture":true}',
      type: 2
    }] : []),
    statesPayload: releasePayload('SpellStateData', []),
    typesPayload: releasePayload('SpellTypeData', [{
      id: 5,
      longNameId: 3001,
      shortNameId: 3002
    }]),
    effectsPayload: releasePayload('EffectData', effectMetadata ? [effect] : []),
    translationsPayload: {
      entries: {
        '1001': 'Puissance fixture',
        '1002': 'Iop',
        '2001': 'Augmente la Puissance.',
        '2002': 'Augmente la Puissance de #1.',
        '3001': 'Sort de classe',
        '3002': 'Classe'
      }
    },
    runtimeCatalog: { spells: [] },
    gameVersion: { version: 'fixture' },
    generatedAt: 'fixture',
    characterLevel: 200
  });
}

function certificationSourceFixture({
  normal = [700, 701],
  critical = [702],
  scripts = [],
  states = []
} = {}) {
  return {
    id: 999,
    effects: normal.map((effectId) => ({ effectId })),
    criticalEffects: critical.map((effectId) => ({ effectId })),
    scripts: {
      bound: scripts.map((scriptId, index) => ({ scriptId, order: index }))
    },
    stateReferences: states.map((stateId, index) => ({
      path: `fixture.state${index}Id`,
      ids: [stateId]
    }))
  };
}

function completeCoverage(sourceSpell) {
  return {
    effects: {
      classifiedIds: sourceEffectOccurrenceIds(sourceSpell),
      unresolvedIds: [],
      ignoredIds: []
    },
    scripts: {
      classifiedIds: sourceBoundScriptOccurrenceIds(sourceSpell),
      unresolvedIds: [],
      ignoredIds: []
    },
    states: {
      classifiedIds: sourceStateReferenceOccurrenceIds(sourceSpell),
      unresolvedIds: [],
      ignoredIds: []
    }
  };
}

function fixtureCertification(sourceSpell, {
  sourceCoverage = completeCoverage(sourceSpell),
  ignoredSource = {}
} = {}) {
  const spellId = 'fixture-certified';
  return createPlannerSourceCertification({
    spellId,
    sourceSpell,
    certifiedSemantics: ['damage', 'ap-cost', 'crit', 'range', 'cast-limits', 'cooldown', 'targeting'],
    sourceCoverage,
    ignoredSource,
    evidence: [{
      source: 'fixture:source-bound-certification',
      spellId,
      proof: 'Spell-level T1 semantics remain independently source-backed while occurrence coverage is source-bound.',
      semantics: ['damage', 'ap-cost', 'crit', 'range', 'cast-limits', 'cooldown', 'targeting']
    }]
  });
}

test('effectId joins exact effect metadata, proven translations, and preserves source effect fields', () => {
  const artifact = makeSourceTruth();
  const entry = artifact.spells[0];
  const effect = entry.effects[0];

  assert.equal(artifact.schemaVersion, 2);
  assert.equal(artifact.source.rawAssetCounts.effects, 1);
  assert.equal(artifact.source.effectMetadataJoin, 'effect-id');
  assert.equal(effect.effectId, 700);
  assert.equal(effect.metadataJoinStatus, 'joined');
  assert.equal(effect.effectMetadata.id, 700);
  assert.equal(effect.effectMetadata.descriptionId, 2001);
  assert.equal(effect.effectMetadata.characteristic, 19);
  assert.equal(effect.effectMetadata.category, 2);
  assert.equal(effect.effectMetadata.characteristicOperator, '+');
  assert.equal(effect.effectMetadata.useDice, true);
  assert.equal(effect.effectMetadata.active, true);
  assert.equal(effect.effectMetadata.localizedDescription, 'Augmente la Puissance.');
  assert.equal(effect.effectMetadata.localizedTheoreticalDescription, 'Augmente la Puissance de #1.');
  assert.equal(effect.sourceDescription, 'Augmente la Puissance.');

  assert.equal(effect.order, 4);
  assert.equal(effect.triggers, 'I');
  assert.equal(effect.duration, 2);
  assert.equal(effect.delay, 1);
  assert.equal(effect.targetMask, 'a,A');
  assert.equal(effect.diceNum, 100);
  assert.equal(effect.diceSide, 0);
  assert.equal(effect.value, 0);
  assert.equal(effect.random, 0);
  assert.equal(effect.group, 0);
});

test('missing effect metadata is explicit and blocks runtime support', () => {
  const artifact = makeSourceTruth({ effectMetadata: false });
  const entry = artifact.spells[0];
  assert.equal(entry.effects[0].effectMetadata, null);
  assert.equal(entry.effects[0].metadataJoinStatus, 'missing');
  assert.ok(entry.unresolvedReasons.includes('effect-metadata-not-found'));
  assert.equal(artifact.coverage.effectMetadataMissing, 1);
});

test('bound script usage joins scriptId metadata and preserves rawParams/type', () => {
  const artifact = makeSourceTruth({ boundScriptId: 77, scriptMetadata: true });
  const entry = artifact.spells[0];

  assert.equal(entry.scripts.metadataJoinStatus, 'joined');
  assert.equal(entry.scripts.bound[0].scriptId, 77);
  assert.equal(entry.scripts.bound[0].metadataJoinStatus, 'joined');
  assert.equal(entry.scripts.bound[0].scriptMetadata.id, 77);
  assert.equal(entry.scripts.bound[0].scriptMetadata.type, 2);
  assert.equal(entry.scripts.bound[0].scriptMetadata.rawParams, '{"fixture":true}');
  assert.deepEqual(entry.scripts.standaloneMetadata, [entry.scripts.bound[0].scriptMetadata]);
  assert.ok(entry.unresolvedReasons.includes('bound-script-semantics-not-certified'));
  assert.equal(artifact.coverage.scriptMetadataMissing, 0);
});

test('missing script metadata is explicit and cannot be mistaken for joined semantics', () => {
  const artifact = makeSourceTruth({ boundScriptId: 88, scriptMetadata: false });
  const entry = artifact.spells[0];

  assert.equal(entry.scripts.metadataJoinStatus, 'missing');
  assert.equal(entry.scripts.bound[0].scriptMetadata, null);
  assert.equal(entry.scripts.bound[0].metadataJoinStatus, 'missing');
  assert.deepEqual(entry.scripts.standaloneMetadata, []);
  assert.ok(entry.unresolvedReasons.includes('bound-script-metadata-not-found'));
  assert.equal(artifact.coverage.scriptMetadataMissing, 1);
});

test('actual source with three effects rejects a caller manifest that mentions only two', () => {
  const sourceSpell = certificationSourceFixture();
  const actualEffects = sourceEffectOccurrenceIds(sourceSpell);
  const certification = fixtureCertification(sourceSpell, {
    sourceCoverage: {
      ...completeCoverage(sourceSpell),
      effects: {
        actualIds: actualEffects.slice(0, 2),
        classifiedIds: actualEffects.slice(0, 2),
        unresolvedIds: [],
        ignoredIds: []
      }
    }
  });

  assert.deepEqual(certification.sourceCoverage.effects.actualIds, [...actualEffects].sort());
  assert.equal(certification.sourceComplete, false);
  const validation = validatePlannerSourceCertification('fixture-certified', certification);
  assert.equal(validation.eligible, false);
  assert.ok(validation.reasons.includes('SOURCE_EFFECT_COVERAGE_INCOMPLETE'));
});

test('actual source with three effects passes when all three occurrences are classified', () => {
  const sourceSpell = certificationSourceFixture();
  const certification = fixtureCertification(sourceSpell);
  assert.equal(certification.sourceComplete, true);
  assert.equal(validatePlannerSourceCertification('fixture-certified', certification).eligible, true);
});

test('actual bound script omitted from classification fails', () => {
  const sourceSpell = certificationSourceFixture({ scripts: [77] });
  const coverage = completeCoverage(sourceSpell);
  coverage.scripts = { classifiedIds: [], unresolvedIds: [], ignoredIds: [] };
  const certification = fixtureCertification(sourceSpell, { sourceCoverage: coverage });

  const validation = validatePlannerSourceCertification('fixture-certified', certification);
  assert.equal(validation.eligible, false);
  assert.ok(validation.reasons.includes('SOURCE_SCRIPT_COVERAGE_INCOMPLETE'));
});

test('bound script classified unresolved blocks certification', () => {
  const sourceSpell = certificationSourceFixture({ scripts: [77] });
  const coverage = completeCoverage(sourceSpell);
  coverage.scripts = {
    classifiedIds: [],
    unresolvedIds: sourceBoundScriptOccurrenceIds(sourceSpell),
    ignoredIds: []
  };
  const certification = fixtureCertification(sourceSpell, { sourceCoverage: coverage });

  const validation = validatePlannerSourceCertification('fixture-certified', certification);
  assert.equal(validation.eligible, false);
  assert.ok(validation.reasons.includes('SOURCE_SCRIPTS_UNRESOLVED'));
});

test('bound script ignored with explicit T1-irrelevance proof passes', () => {
  const sourceSpell = certificationSourceFixture({ scripts: [77] });
  const scriptId = sourceBoundScriptOccurrenceIds(sourceSpell)[0];
  const coverage = completeCoverage(sourceSpell);
  coverage.scripts = { classifiedIds: [], unresolvedIds: [], ignoredIds: [scriptId] };
  const certification = fixtureCertification(sourceSpell, {
    sourceCoverage: coverage,
    ignoredSource: {
      scripts: [{
        sourceOccurrenceId: scriptId,
        justification: 'Fixture certifies this script cannot execute or affect the T1 result.',
        certifiedIrrelevantToT1: true
      }]
    }
  });

  assert.equal(validatePlannerSourceCertification('fixture-certified', certification).eligible, true);
});

test('actual state reference omitted from classification fails', () => {
  const sourceSpell = certificationSourceFixture({ states: [321] });
  const coverage = completeCoverage(sourceSpell);
  coverage.states = { classifiedIds: [], unresolvedIds: [], ignoredIds: [] };
  const certification = fixtureCertification(sourceSpell, { sourceCoverage: coverage });

  const validation = validatePlannerSourceCertification('fixture-certified', certification);
  assert.equal(validation.eligible, false);
  assert.ok(validation.reasons.includes('SOURCE_STATE_COVERAGE_INCOMPLETE'));
});

test('state reference classified unresolved blocks certification', () => {
  const sourceSpell = certificationSourceFixture({ states: [321] });
  const coverage = completeCoverage(sourceSpell);
  coverage.states = {
    classifiedIds: [],
    unresolvedIds: sourceStateReferenceOccurrenceIds(sourceSpell),
    ignoredIds: []
  };
  const certification = fixtureCertification(sourceSpell, { sourceCoverage: coverage });

  const validation = validatePlannerSourceCertification('fixture-certified', certification);
  assert.equal(validation.eligible, false);
  assert.ok(validation.reasons.includes('SOURCE_STATES_UNRESOLVED'));
});

test('state reference ignored with explicit T1-irrelevance proof passes', () => {
  const sourceSpell = certificationSourceFixture({ states: [321] });
  const stateId = sourceStateReferenceOccurrenceIds(sourceSpell)[0];
  const coverage = completeCoverage(sourceSpell);
  coverage.states = { classifiedIds: [], unresolvedIds: [], ignoredIds: [stateId] };
  const certification = fixtureCertification(sourceSpell, {
    sourceCoverage: coverage,
    ignoredSource: {
      states: [{
        sourceOccurrenceId: stateId,
        justification: 'Fixture certifies this state reference is outside T1 and cannot affect the T1 result.',
        certifiedIrrelevantToT1: true
      }]
    }
  });

  assert.equal(validatePlannerSourceCertification('fixture-certified', certification).eligible, true);
});

test('classification buckets cannot overlap', () => {
  const sourceSpell = certificationSourceFixture();
  const actualEffects = sourceEffectOccurrenceIds(sourceSpell);
  const coverage = completeCoverage(sourceSpell);
  coverage.effects = {
    classifiedIds: actualEffects,
    unresolvedIds: [],
    ignoredIds: [actualEffects[0]]
  };
  const certification = fixtureCertification(sourceSpell, {
    sourceCoverage: coverage,
    ignoredSource: {
      effects: [{
        sourceOccurrenceId: actualEffects[0],
        justification: 'Proof exists, but overlap itself remains invalid.',
        certifiedIrrelevantToT1: true
      }]
    }
  });

  const validation = validatePlannerSourceCertification('fixture-certified', certification);
  assert.equal(validation.eligible, false);
  assert.ok(validation.reasons.includes('SOURCE_EFFECT_COVERAGE_OVERLAP'));
});

test('certification without a real source entry cannot become source-complete', () => {
  const spellId = 'fixture-no-source';
  const certification = createPlannerSourceCertification({
    spellId,
    certifiedSemantics: ['damage'],
    sourceCoverage: {
      effects: {
        actualIds: ['normal:0:700'],
        classifiedIds: ['normal:0:700'],
        unresolvedIds: [],
        ignoredIds: []
      }
    },
    evidence: [{
      source: 'fixture:caller-only',
      spellId,
      proof: 'Caller-provided universe is intentionally not accepted as source truth.',
      semantics: ['damage']
    }]
  });

  assert.equal(certification.sourceComplete, false);
  assert.equal(certification.sourceBound, false);
  const validation = validatePlannerSourceCertification(spellId, certification);
  assert.equal(validation.eligible, false);
  assert.ok(validation.reasons.includes('SOURCE_TRUTH_MISSING'));
});
