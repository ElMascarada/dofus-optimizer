import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import {
  createPlannerSourceCertification,
  sourceEffectOccurrenceIds,
  sourceBoundScriptOccurrenceIds,
  sourceStateReferenceOccurrenceIds,
  validatePlannerSourceCertification
} from '../js/combat/source-certification.js';
import { normalizeSpellEffectSemantics } from '../js/combat/spell-effect-semantic.js';
import { certifiedT1SpellEligibility } from '../js/combat/t1-certified-planner.js';
import { spellDamageBreakdown } from '../js/spells.js';
import { applyCuratedSpellRules } from '../js/curated-runtime-rules.js';

const readJson = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const reviews = readJson('../data/knowledge/iop-terre-source-semantics.json').spells;
const sourceTruth = readJson('../data/normalized/spell-source-truth.json');
const runtime = readJson('../data/normalized/spell-data.json');

const closureSpellIds = [13106, 13123, 13125, 13118, 13156, 13124, 13110];
const expectedOccurrenceCounts = new Map([
  [13106, { effects: 4, scripts: 1, states: 0 }],
  [13123, { effects: 4, scripts: 1, states: 0 }],
  [13125, { effects: 2, scripts: 1, states: 0 }],
  [13118, { effects: 4, scripts: 1, states: 0 }],
  [13156, { effects: 6, scripts: 1, states: 0 }],
  [13124, { effects: 6, scripts: 2, states: 0 }],
  [13110, { effects: 4, scripts: 1, states: 0 }],
  [13146, { effects: 6, scripts: 2, states: 0 }]
]);

function sortedValue(value) {
  if (Array.isArray(value)) return value.map(sortedValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortedValue(value[key])]));
  }
  return value;
}

function ignoredSourceEntries(review, kind) {
  return review.ignoredSource?.[kind] || [];
}

function ignoredSourceIds(review, kind) {
  return ignoredSourceEntries(review, kind).map((entry) => entry.sourceOccurrenceId);
}

function targetingOf(source) {
  return source.level?.targeting || source.targeting || {};
}

function certification(review, source) {
  const ignoredEffectIds = new Set(ignoredSourceIds(review, 'effects'));
  const ignoredScriptIds = new Set(ignoredSourceIds(review, 'scripts'));
  const ignoredSemanticIds = new Set((review.ignoredSemantics || []).map((entry) => entry.semantic));
  const semantics = review.effects.flatMap((sourceEntry) => sourceEntry.semantics.map((semantic) => ({
    ...semantic,
    sourceOccurrenceId: sourceEntry.sourceOccurrenceId
  })));
  const relevantSemantics = semantics.filter((entry) =>
    !ignoredEffectIds.has(entry.sourceOccurrenceId) && !ignoredSemanticIds.has(entry.id));
  const supported = relevantSemantics.filter((entry) => entry.status === 'SUPPORTED');
  const unresolvedScripts = review.scripts
    .filter((entry) => entry.status === 'UNRESOLVED' && !ignoredScriptIds.has(entry.sourceOccurrenceId))
    .map((entry) => entry.sourceOccurrenceId);

  return createPlannerSourceCertification({
    spellId: String(review.spellId),
    sourceSpell: source,
    certifiedSemantics: supported.map((entry) => entry.id),
    unresolvedSemantics: [
      ...relevantSemantics.filter((entry) => entry.status === 'UNRESOLVED').map((entry) => entry.id),
      ...unresolvedScripts
    ],
    ignoredSemantics: review.ignoredSemantics || [],
    ignoredSource: review.ignoredSource || {},
    criticalSemantics: review.criticalSemantics,
    sourceCoverage: Object.fromEntries(['effects', 'scripts', 'states'].map((kind) => {
      const ignored = new Set(ignoredSourceIds(review, kind));
      return [kind, {
        classifiedIds: review[kind]
          .filter((entry) => entry.status === 'SUPPORTED' && !ignored.has(entry.sourceOccurrenceId))
          .map((entry) => entry.sourceOccurrenceId),
        unresolvedIds: review[kind]
          .filter((entry) => entry.status === 'UNRESOLVED' && !ignored.has(entry.sourceOccurrenceId))
          .map((entry) => entry.sourceOccurrenceId),
        ignoredIds: [...ignored]
      }];
    })),
    evidence: supported.map((entry) => ({
      source: 'data/normalized/spell-source-truth.json + canonical offline semantic review',
      spellId: String(review.spellId),
      proof: entry.proof,
      semantics: [entry.id]
    }))
  });
}

test('Iop Terre closure reviews exactly the requested seven spells while preserving the existing Pugilat review', () => {
  assert.deepEqual(reviews.map((entry) => entry.spellId), [13106, 13123, 13125, 13146, 13118, 13156, 13124, 13110]);
  assert.deepEqual(reviews.filter((entry) => closureSpellIds.includes(entry.spellId)).map((entry) => entry.spellId), closureSpellIds);
});

for (const review of reviews) {
  const source = sourceTruth.spells.find((entry) => entry.id === review.spellId);
  const spell = runtime.spells.find((entry) => entry.ankamaId === review.spellId);

  test(`${review.name}: every normal, critical, script and state occurrence is explicitly reviewed`, () => {
    assert.ok(source, `source spell ${review.spellId} must exist`);
    const hash = createHash('sha256').update(JSON.stringify(sortedValue(source))).digest('hex');
    assert.equal(hash, review.sourceRecordSha256, 'any whole-record source drift requires semantic re-review');
    assert.deepEqual(review.effects.map((entry) => entry.sourceOccurrenceId), sourceEffectOccurrenceIds(source));
    assert.deepEqual(review.scripts.map((entry) => entry.sourceOccurrenceId), sourceBoundScriptOccurrenceIds(source));
    assert.deepEqual(review.states.map((entry) => entry.sourceOccurrenceId), sourceStateReferenceOccurrenceIds(source));

    const expected = expectedOccurrenceCounts.get(review.spellId);
    assert.ok(expected, `missing deterministic count fixture for ${review.spellId}`);
    assert.equal(review.effects.length, expected.effects);
    assert.equal(review.scripts.length, expected.scripts);
    assert.equal(review.states.length, expected.states);
    assert.deepEqual(source.stateReferences, []);

    for (const script of source.scripts.bound) {
      assert.equal(script.scriptMetadata, null);
      assert.equal(script.metadataJoinStatus, 'missing');
    }

    const ignoredEffects = new Set(ignoredSourceIds(review, 'effects'));
    const ignoredSemantics = new Set((review.ignoredSemantics || []).map((entry) => entry.semantic));
    for (const [index, entry] of review.effects.entries()) {
      const raw = [...source.effects, ...source.criticalEffects][index];
      assert.equal(entry.effectId, raw.effectId);
      assert.equal(entry.sourceOrder, raw.order);
      assert.equal(raw.metadataJoinStatus, 'joined');
      assert.equal(raw.effectMetadata.id, raw.effectId);
      assert.equal(entry.status, 'UNRESOLVED');
      const semantics = normalizeSpellEffectSemantics(entry.semantics);
      assert.ok(semantics.length > 0);
      for (const semantic of semantics) {
        assert.ok(semantic.proof.length > 0);
        if (semantic.status === 'UNRESOLVED'
          && !ignoredEffects.has(entry.sourceOccurrenceId)
          && !ignoredSemantics.has(semantic.id)) {
          assert.ok(semantic.missingRuntimePrimitive.length > 0);
        }
      }
      const target = semantics.find((semantic) => semantic.type === 'target');
      assert.ok(target, `${entry.sourceOccurrenceId} must preserve target evidence`);
      assert.equal(target.status, 'UNRESOLVED');
      assert.equal(target.sourceMask, raw.targetMask);
    }
  });

  test(`${review.name}: complete occurrence accounting remains fail-closed while relevant semantics are unresolved`, () => {
    const proof = certification(review, source);
    assert.equal(proof.sourceComplete, false);
    assert.equal(proof.sourceSemanticStatus, 'UNRESOLVED');
    const validation = validatePlannerSourceCertification(String(review.spellId), proof, source);
    assert.equal(validation.eligible, false);
    assert.ok(!validation.reasons.some((reason) => /COVERAGE_(INCOMPLETE|EXTRA|OVERLAP|SOURCE_MISMATCH)/.test(reason)));
    for (const kind of ['effects', 'scripts', 'states']) {
      assert.deepEqual(proof.sourceCoverage[kind].ignoredIds, ignoredSourceIds(review, kind).map(String).sort());
    }
    const ignoredEffects = new Set(ignoredSourceIds(review, 'effects'));
    const eligibility = certifiedT1SpellEligibility({
      spell,
      sourceSpell: source,
      sourceCertification: proof,
      effects: review.effects
        .filter((entry) => !ignoredEffects.has(entry.sourceOccurrenceId))
        .flatMap((entry) => entry.semantics)
    });
    assert.equal(eligibility.eligible, false);
    assert.ok(eligibility.reasons.includes('UNRESOLVED_RUNTIME_EFFECTS'));
  });
}

test('the seven-spell closure has exact deterministic occurrence counts', () => {
  assert.deepEqual(closureSpellIds.map((spellId) => [spellId, expectedOccurrenceCounts.get(spellId)]), [
    [13106, { effects: 4, scripts: 1, states: 0 }],
    [13123, { effects: 4, scripts: 1, states: 0 }],
    [13125, { effects: 2, scripts: 1, states: 0 }],
    [13118, { effects: 4, scripts: 1, states: 0 }],
    [13156, { effects: 6, scripts: 1, states: 0 }],
    [13124, { effects: 6, scripts: 2, states: 0 }],
    [13110, { effects: 4, scripts: 1, states: 0 }]
  ]);
});

test('source coverage fails closed on omitted and extra occurrences', () => {
  const review = reviews.find((entry) => entry.spellId === 13156);
  const source = sourceTruth.spells.find((entry) => entry.id === 13156);
  const proof = certification(review, source);

  const omitted = structuredClone(proof);
  omitted.sourceCoverage.effects.unresolvedIds = omitted.sourceCoverage.effects.unresolvedIds.slice(1);
  assert.ok(validatePlannerSourceCertification('13156', omitted, source).reasons.includes('SOURCE_EFFECT_COVERAGE_INCOMPLETE'));

  const extra = structuredClone(proof);
  extra.sourceCoverage.effects.unresolvedIds.push('normal:999:999999');
  assert.ok(validatePlannerSourceCertification('13156', extra, source).reasons.includes('SOURCE_EFFECT_COVERAGE_EXTRA'));
});

test('whole-record SHA drift and live occurrence drift both fail closed', () => {
  const review = reviews.find((entry) => entry.spellId === 13124);
  const source = sourceTruth.spells.find((entry) => entry.id === 13124);
  const changed = structuredClone(source);
  changed.effects[0].diceNum += 1;
  const changedHash = createHash('sha256').update(JSON.stringify(sortedValue(changed))).digest('hex');
  assert.notEqual(changedHash, review.sourceRecordSha256);

  const proof = certification(review, source);
  const shapeChanged = structuredClone(source);
  shapeChanged.effects.push(structuredClone(source.effects[0]));
  assert.ok(validatePlannerSourceCertification('13124', proof, shapeChanged).reasons.includes('SOURCE_EFFECT_COVERAGE_SOURCE_MISMATCH'));
});

test('certified irrelevant source occurrences require non-empty proof and certifiedIrrelevantToT1=true', () => {
  for (const review of reviews.filter((entry) => Object.values(entry.ignoredSource || {}).some((rows) => rows.length > 0))) {
    const source = sourceTruth.spells.find((entry) => entry.id === review.spellId);
    const proof = certification(review, source);
    for (const kind of ['effects', 'scripts', 'states']) {
      const actual = new Set(kind === 'effects'
        ? sourceEffectOccurrenceIds(source)
        : kind === 'scripts'
          ? sourceBoundScriptOccurrenceIds(source)
          : sourceStateReferenceOccurrenceIds(source));
      for (const entry of ignoredSourceEntries(review, kind)) {
        assert.ok(actual.has(entry.sourceOccurrenceId));
        assert.ok(entry.justification.trim().length > 0);
        assert.equal(entry.certifiedIrrelevantToT1, true);
        assert.ok(proof.sourceCoverage[kind].ignoredIds.includes(entry.sourceOccurrenceId));
      }
    }
  }

  const fureur = reviews.find((entry) => entry.spellId === 13156);
  const source = sourceTruth.spells.find((entry) => entry.id === 13156);
  for (const mutation of [
    (entry) => { entry.justification = ''; },
    (entry) => { entry.certifiedIrrelevantToT1 = false; }
  ]) {
    const broken = structuredClone(fureur);
    mutation(broken.ignoredSource.effects[0]);
    assert.ok(validatePlannerSourceCertification('13156', certification(broken, source), source)
      .reasons.includes('IGNORED_SOURCE_EFFECTS_UNCERTIFIED'));
  }
});

test('an unresolved relevant occurrence prevents certification even when all source ids are accounted for', () => {
  const divine = reviews.find((entry) => entry.spellId === 13110);
  const source = sourceTruth.spells.find((entry) => entry.id === 13110);
  const proof = certification(divine, source);
  assert.ok(proof.unresolvedSemantics.includes('normal:1:112:damage-buff'));
  const validation = validatePlannerSourceCertification('13110', proof, source);
  assert.ok(validation.reasons.includes('SOURCE_SEMANTICS_UNRESOLVED'));
  assert.ok(validation.reasons.includes('SOURCE_EFFECTS_UNRESOLVED'));
  assert.equal(validation.eligible, false);
});

test('Pression erosion stays certified irrelevant without changing its existing source review', () => {
  const review = reviews.find((entry) => entry.spellId === 13106);
  const source = sourceTruth.spells.find((entry) => entry.id === 13106);
  assert.deepEqual(ignoredSourceIds(review, 'effects').sort(), ['critical:0:776', 'normal:0:776']);
  assert.equal(review.sourceRecordSha256, '6424e27fd5f8b90f9f2941c8fba9a4e1cf031179b267968d5e99a8d1cc09d784');
  assert.deepEqual(source.effects.map((entry) => entry.effectId), [776, 97]);
  assert.deepEqual(review.scripts.map((entry) => [entry.scriptId, entry.status]), [[16115, 'UNRESOLVED']]);
});

test('Concentration invocation-only higher branch remains ignored without decoding masks', () => {
  const review = reviews.find((entry) => entry.spellId === 13123);
  const source = sourceTruth.spells.find((entry) => entry.id === 13123);
  const spell = runtime.spells.find((entry) => entry.ankamaId === 13123);
  const curated = applyCuratedSpellRules(spell);
  assert.deepEqual(source.effects.map((entry) => entry.targetMask), ['L,M,l,m,c', 'J,j']);
  assert.deepEqual(ignoredSourceIds(review, 'effects').sort(), ['critical:1:97', 'normal:1:97']);
  assert.equal(curated.hits.length, 1);
  assert.deepEqual(curated.hits[0], { element: 'earth', normal: [20, 24], crit: [25, 30] });
});

test('Épée de Iop preserves target-zone applicability and bound script 16119 as unresolved', () => {
  const review = reviews.find((entry) => entry.spellId === 13125);
  const source = sourceTruth.spells.find((entry) => entry.id === 13125);
  assert.deepEqual(source.effects.map((entry) => entry.effectId), [97]);
  assert.deepEqual(source.criticalEffects.map((entry) => entry.effectId), [97]);
  assert.deepEqual(source.effects.map((entry) => entry.targetMask), ['A,g']);
  assert.deepEqual(review.scripts.map((entry) => entry.scriptId), [16119]);
  assert.ok(review.scripts.every((entry) => entry.status === 'UNRESOLVED'));
});

test('Pugilat review is preserved outside the seven-spell closure', () => {
  const review = reviews.find((entry) => entry.spellId === 13146);
  const source = sourceTruth.spells.find((entry) => entry.id === 13146);
  assert.equal(review.sourceRecordSha256, '7cd6529eeeb95a8b687aef410ae1d72892e4a5648349367b4e1f6bc0fa210b6a');
  assert.deepEqual(source.effects.map((entry) => entry.effectId), [97, 293, 406]);
  assert.deepEqual(source.scripts.bound.map((entry) => entry.scriptId), [16122, 16123]);
});

test('Puissance keeps offensive self-buffs relevant and fails closed on target/script semantics', () => {
  const review = reviews.find((entry) => entry.spellId === 13118);
  const source = sourceTruth.spells.find((entry) => entry.id === 13118);
  assert.deepEqual(source.effects.map((entry) => [entry.effectId, entry.diceNum, entry.duration]), [[138, 300, 3], [414, 120, 3]]);
  assert.deepEqual(source.criticalEffects.map((entry) => [entry.effectId, entry.diceNum, entry.duration]), [[138, 350, 3], [414, 140, 3]]);
  assert.equal(targetingOf(source).minCastInterval, 4);
  assert.deepEqual(review.scripts.map((entry) => entry.scriptId), [16093]);
  assert.deepEqual(ignoredSourceIds(review, 'effects'), []);
  assert.ok(review.effects.flatMap((entry) => entry.semantics).some((entry) => entry.id === 'normal:0:138:power-buff' && entry.status === 'SUPPORTED'));
});

test('Fureur future effect-293 charge is T1-irrelevant only because maxCastPerTurn=1', () => {
  const review = reviews.find((entry) => entry.spellId === 13156);
  const source = sourceTruth.spells.find((entry) => entry.id === 13156);
  assert.equal(targetingOf(source).maxCastPerTurn, 1);
  assert.deepEqual(ignoredSourceIds(review, 'effects').sort(), ['critical:1:293', 'normal:1:293']);
  assert.ok(ignoredSourceEntries(review, 'effects').every((entry) => /maxCastPerTurn=1/.test(entry.justification)));
  assert.deepEqual(review.effects.filter((entry) => entry.effectId === 1160).map((entry) => entry.status), ['UNRESOLVED', 'UNRESOLVED']);
  assert.deepEqual(review.scripts.map((entry) => [entry.scriptId, entry.status]), [[16120, 'UNRESOLVED']]);
});

test('Colère delay=3 future effects are T1-irrelevant while bound scripts remain unresolved', () => {
  const review = reviews.find((entry) => entry.spellId === 13124);
  const source = sourceTruth.spells.find((entry) => entry.id === 13124);
  assert.equal(targetingOf(source).minCastInterval, 3);
  assert.deepEqual(source.effects.map((entry) => [entry.effectId, entry.delay]), [[97, 0], [3793, 3], [293, 3]]);
  assert.deepEqual(ignoredSourceIds(review, 'effects').sort(), ['critical:1:3793', 'critical:2:293', 'normal:1:3793', 'normal:2:293']);
  assert.ok(ignoredSourceEntries(review, 'effects').every((entry) => /delay=3|minCastInterval=3/.test(entry.justification)));
  assert.deepEqual(review.scripts.map((entry) => [entry.scriptId, entry.status]), [[16107, 'UNRESOLVED'], [16121, 'UNRESOLVED']]);
});

test('Épée Divine offensive +30 Damage buff remains fail-closed because two T1 casts can stack or refresh differently', () => {
  const review = reviews.find((entry) => entry.spellId === 13110);
  const source = sourceTruth.spells.find((entry) => entry.id === 13110);
  assert.equal(targetingOf(source).maxCastPerTurn, 2);
  assert.deepEqual(source.effects.map((entry) => [entry.effectId, entry.diceNum, entry.duration]), [[98, 24, 0], [112, 30, 4]]);
  assert.deepEqual(source.criticalEffects.map((entry) => [entry.effectId, entry.diceNum, entry.duration]), [[98, 29, 0], [112, 30, 4]]);
  const buffs = review.effects.flatMap((entry) => entry.semantics).filter((entry) => entry.id.endsWith(':damage-buff'));
  assert.equal(buffs.length, 2);
  assert.ok(buffs.every((entry) => entry.status === 'UNRESOLVED'));
  assert.ok(buffs.every((entry) => /stacking|stack/.test(entry.missingRuntimePrimitive)));
  assert.deepEqual(review.scripts.map((entry) => [entry.scriptId, entry.status]), [[16135, 'UNRESOLVED']]);
});

test('Earth damage arithmetic remains represented independently of unresolved applicability', () => {
  for (const spellId of [13106, 13123, 13125, 13156, 13124]) {
    const review = reviews.find((entry) => entry.spellId === spellId);
    const source = sourceTruth.spells.find((entry) => entry.id === spellId);
    const normal = source.effects.filter((entry) => entry.effectId === 97);
    const critical = source.criticalEffects.filter((entry) => entry.effectId === 97);
    assert.equal(normal.length, critical.length);
    for (const [index, effect] of normal.entries()) {
      const crit = critical[index];
      const reviewedNormal = review.effects.find((entry) => entry.sourceOrder === effect.order);
      const reviewedCrit = review.effects.find((entry) => entry.sourceOrder === crit.order);
      assert.deepEqual(reviewedNormal.semantics.find((entry) => entry.type === 'damage').range, [effect.diceNum, effect.diceSide]);
      assert.deepEqual(reviewedCrit.semantics.find((entry) => entry.type === 'damage').range, [crit.diceNum, crit.diceSide]);
      const projected = { hits: [{ element: 'earth', normal: [effect.diceNum, effect.diceSide], crit: [crit.diceNum, crit.diceSide] }] };
      const plain = spellDamageBreakdown(projected, {});
      assert.deepEqual(plain.normal, projected.hits[0].normal);
      assert.deepEqual(plain.critical, projected.hits[0].crit);
    }
  }
});

test('temporary Iop T1 source extraction probe is removed from the final branch', () => {
  assert.equal(existsSync(new URL('./iop-t1-source-extraction.tmp.test.mjs', import.meta.url)), false);
});
