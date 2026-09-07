import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeSpellSourceTruthWithMetadata } from '../js/dofus-spell-source-semantics.js';
import {
  createPlannerSourceCertification,
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

test('source completeness manifest certifies only an exact, gap-free classification', () => {
  const spellId = 'fixture-complete';
  const sourceEffectIds = ['normal:0:700', 'critical:0:700'];
  const certification = createPlannerSourceCertification({
    spellId,
    certifiedSemantics: ['damage', 'ap-cost', 'cast-limits', 'crit'],
    sourceEffectCoverage: {
      sourceEffectIds,
      classifiedEffectIds: sourceEffectIds,
      unresolvedEffectIds: [],
      ignoredEffectIds: []
    },
    evidence: [{
      source: 'fixture:complete-source',
      spellId,
      proof: 'Every source effect occurrence is classified by this fixture.',
      semantics: ['damage', 'ap-cost', 'cast-limits', 'crit']
    }]
  });

  assert.equal(certification.sourceComplete, true);
  assert.equal(validatePlannerSourceCertification(spellId, certification).eligible, true);
});

test('source completeness manifest rejects an unclassified relevant source effect', () => {
  const spellId = 'fixture-incomplete';
  const certification = createPlannerSourceCertification({
    spellId,
    certifiedSemantics: ['damage'],
    sourceEffectCoverage: {
      sourceEffectIds: ['normal:0:700', 'normal:1:701'],
      classifiedEffectIds: ['normal:0:700'],
      unresolvedEffectIds: [],
      ignoredEffectIds: []
    },
    evidence: [{
      source: 'fixture:incomplete-source',
      spellId,
      proof: 'Only one of two source effects is deliberately classified.',
      semantics: ['damage']
    }]
  });

  assert.equal(certification.sourceComplete, false);
  const validation = validatePlannerSourceCertification(spellId, certification);
  assert.equal(validation.eligible, false);
  assert.ok(validation.reasons.includes('SOURCE_EFFECT_COVERAGE_INCOMPLETE'));
});

test('ignored source effects require explicit T1-irrelevance proof', () => {
  const spellId = 'fixture-ignored';
  const incomplete = createPlannerSourceCertification({
    spellId,
    certifiedSemantics: ['damage'],
    sourceEffectCoverage: {
      sourceEffectIds: ['normal:0:700', 'normal:1:999'],
      classifiedEffectIds: ['normal:0:700'],
      unresolvedEffectIds: [],
      ignoredEffectIds: ['normal:1:999']
    },
    evidence: [{
      source: 'fixture:ignored-source',
      spellId,
      proof: 'Damage semantics are source-backed.',
      semantics: ['damage']
    }]
  });
  assert.equal(incomplete.sourceComplete, false);
  assert.ok(validatePlannerSourceCertification(spellId, incomplete).reasons.includes('IGNORED_SOURCE_EFFECTS_UNCERTIFIED'));

  const complete = createPlannerSourceCertification({
    spellId,
    certifiedSemantics: ['damage'],
    sourceEffectCoverage: {
      sourceEffectIds: ['normal:0:700', 'normal:1:999'],
      classifiedEffectIds: ['normal:0:700'],
      unresolvedEffectIds: [],
      ignoredEffectIds: ['normal:1:999']
    },
    ignoredSourceEffects: [{
      sourceEffectId: 'normal:1:999',
      justification: 'Fixture proves this source effect occurs after T1 and cannot affect the T1 result.',
      certifiedIrrelevantToT1: true
    }],
    evidence: [{
      source: 'fixture:ignored-source',
      spellId,
      proof: 'Damage semantics are source-backed.',
      semantics: ['damage']
    }]
  });
  assert.equal(complete.sourceComplete, true);
  assert.equal(validatePlannerSourceCertification(spellId, complete).eligible, true);
});
