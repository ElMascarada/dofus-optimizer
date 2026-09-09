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
import { spellDamageBreakdown } from '../js/spells.js';
import { applyCuratedSpellRules } from '../js/curated-runtime-rules.js';

const readJson = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const reviews = readJson('../data/knowledge/iop-terre-source-semantics.json').spells;
const sourceTruth = readJson('../data/normalized/spell-source-truth.json');
const runtime = readJson('../data/normalized/spell-data.json');

const coreT1SpellIds = [13106, 13123, 13125, 13118, 13156, 13124];
const deferredSpellIds = [13110, 13146];
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

function semantic(review, id) {
  return review.effects.flatMap((entry) => entry.semantics).find((entry) => entry.id === id);
}

test('Iop Terre reference certification closes only the core six and keeps deferred reviews present', () => {
  assert.deepEqual(reviews.map((entry) => entry.spellId), [13106, 13123, 13125, 13146, 13118, 13156, 13124, 13110]);
  assert.deepEqual(reviews.filter((entry) => coreT1SpellIds.includes(entry.spellId)).map((entry) => entry.spellId), coreT1SpellIds);
  assert.deepEqual(reviews.filter((entry) => deferredSpellIds.includes(entry.spellId)).map((entry) => entry.spellId), [13146, 13110]);
});

for (const review of reviews) {
  const source = sourceTruth.spells.find((entry) => entry.id === review.spellId);

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
      assert.ok(['SUPPORTED', 'UNRESOLVED'].includes(entry.status));
      const semantics = normalizeSpellEffectSemantics(entry.semantics);
      assert.ok(semantics.length > 0);
      for (const item of semantics) {
        assert.ok(item.proof.length > 0);
        if (item.status === 'UNRESOLVED'
          && !ignoredEffects.has(entry.sourceOccurrenceId)
          && !ignoredSemantics.has(item.id)) {
          assert.ok(item.missingRuntimePrimitive.length > 0);
        }
      }
      const target = semantics.find((item) => item.type === 'target');
      assert.ok(target, `${entry.sourceOccurrenceId} must preserve target evidence`);
      assert.ok(['SUPPORTED', 'UNRESOLVED'].includes(target.status));
      assert.equal(target.sourceMask, raw.targetMask);
    }
  });

  test(`${review.name}: source completeness is distinct from current planner eligibility`, () => {
    const proof = certification(review, source);
    const validation = validatePlannerSourceCertification(String(review.spellId), proof, source);
    const expectedCertified = coreT1SpellIds.includes(review.spellId);

    assert.equal(review.sourceSemanticStatus, expectedCertified ? 'CERTIFIED' : 'UNRESOLVED');
    assert.equal(proof.sourceComplete, expectedCertified);
    assert.equal(proof.sourceSemanticStatus, expectedCertified ? 'CERTIFIED' : 'UNRESOLVED');
    assert.ok(!validation.reasons.some((reason) => /COVERAGE_(INCOMPLETE|EXTRA|OVERLAP|SOURCE_MISMATCH)/.test(reason)));

    if (expectedCertified) {
      assert.deepEqual(proof.unresolvedSemantics, []);
      if (review.spellId === 13118) {
        assert.equal(validation.eligible, false);
        assert.deepEqual(validation.reasons, ['CRITICAL_STATE_SEMANTICS_UNCERTIFIED']);
      } else {
        assert.equal(validation.eligible, true);
        assert.deepEqual(validation.reasons, []);
      }
    } else {
      assert.equal(validation.eligible, false);
      assert.ok(proof.unresolvedSemantics.length > 0);
      assert.ok(validation.reasons.includes('SOURCE_CERTIFICATION_INCOMPLETE'));
    }
    for (const kind of ['effects', 'scripts', 'states']) {
      assert.deepEqual(proof.sourceCoverage[kind].ignoredIds, ignoredSourceIds(review, kind).map(String).sort());
    }
  });
}

test('the core-six reference pool has exact deterministic occurrence counts', () => {
  assert.deepEqual(coreT1SpellIds.map((spellId) => [spellId, expectedOccurrenceCounts.get(spellId)]), [
    [13106, { effects: 4, scripts: 1, states: 0 }],
    [13123, { effects: 4, scripts: 1, states: 0 }],
    [13125, { effects: 2, scripts: 1, states: 0 }],
    [13118, { effects: 4, scripts: 1, states: 0 }],
    [13156, { effects: 6, scripts: 1, states: 0 }],
    [13124, { effects: 6, scripts: 2, states: 0 }]
  ]);
});

test('source coverage fails closed on omitted and extra occurrences even for a certified core spell', () => {
  const review = reviews.find((entry) => entry.spellId === 13156);
  const source = sourceTruth.spells.find((entry) => entry.id === 13156);
  const proof = certification(review, source);

  const omitted = structuredClone(proof);
  omitted.sourceCoverage.effects.classifiedIds = omitted.sourceCoverage.effects.classifiedIds.slice(1);
  assert.ok(validatePlannerSourceCertification('13156', omitted, source).reasons.includes('SOURCE_EFFECT_COVERAGE_INCOMPLETE'));

  const extra = structuredClone(proof);
  extra.sourceCoverage.effects.classifiedIds.push('normal:999:999999');
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

  const pression = reviews.find((entry) => entry.spellId === 13106);
  const pressionSource = sourceTruth.spells.find((entry) => entry.id === 13106);
  const brokenScript = structuredClone(pression);
  brokenScript.ignoredSource.scripts[0].certifiedIrrelevantToT1 = false;
  assert.ok(validatePlannerSourceCertification('13106', certification(brokenScript, pressionSource), pressionSource)
    .reasons.includes('IGNORED_SOURCE_SCRIPTS_UNCERTIFIED'));
});

test('all seven owner-ignored core scripts are scoped T1 proofs, not global script understanding', () => {
  const expectedScripts = new Map([
    [13106, ['bound:0:16115']],
    [13123, ['bound:0:16118']],
    [13125, ['bound:0:16119']],
    [13118, ['bound:0:16093']],
    [13156, ['bound:0:16120']],
    [13124, ['bound:0:16107', 'bound:1:16121']]
  ]);
  for (const spellId of coreT1SpellIds) {
    const review = reviews.find((entry) => entry.spellId === spellId);
    assert.deepEqual(ignoredSourceIds(review, 'scripts'), expectedScripts.get(spellId));
    assert.ok(ignoredSourceEntries(review, 'scripts').every((entry) => entry.certifiedIrrelevantToT1 === true));
    assert.ok(ignoredSourceEntries(review, 'scripts').every((entry) => /T1|fixed|reference/.test(entry.justification)));
    assert.ok(review.scripts.every((entry) => entry.status === 'UNRESOLVED'));
    assert.ok(review.scripts.every((entry) => /not globally understood|global implementation remains unknown/.test(entry.proof)));
  }
});

test('target applicability is supported only for the exact owner-certified reference applications', () => {
  const expected = [
    [13106, ['normal:1:97:target', 'critical:1:97:target'], /one normal enemy/],
    [13123, ['normal:0:97:target', 'critical:0:97:target'], /one normal non-invocation enemy/],
    [13125, ['normal:0:97:target', 'critical:0:97:target'], /one normal enemy under compatible placement/],
    [13156, ['normal:0:97:target', 'critical:0:97:target'], /one normal enemy/],
    [13124, ['normal:0:97:target', 'critical:0:97:target'], /one normal enemy/],
    [13118, ['normal:0:138:target', 'critical:0:138:target'], /Iop himself/]
  ];
  for (const [spellId, ids, scope] of expected) {
    const review = reviews.find((entry) => entry.spellId === spellId);
    for (const id of ids) {
      const target = semantic(review, id);
      assert.equal(target.status, 'SUPPORTED');
      assert.match(target.proof, scope);
      assert.match(target.proof, /does not decode|fixed reference use|scoped/i);
    }
  }
});

test('an unresolved relevant occurrence still prevents deferred Épée Divine certification', () => {
  const divine = reviews.find((entry) => entry.spellId === 13110);
  const source = sourceTruth.spells.find((entry) => entry.id === 13110);
  const proof = certification(divine, source);
  assert.ok(proof.unresolvedSemantics.includes('normal:1:112:damage-buff'));
  const validation = validatePlannerSourceCertification('13110', proof, source);
  assert.ok(validation.reasons.includes('SOURCE_SEMANTICS_UNRESOLVED'));
  assert.ok(validation.reasons.includes('SOURCE_EFFECTS_UNRESOLVED'));
  assert.equal(validation.eligible, false);
});

test('Pression certifies ordinary-target Earth damage while erosion and script 16115 stay T1-irrelevant only', () => {
  const review = reviews.find((entry) => entry.spellId === 13106);
  const source = sourceTruth.spells.find((entry) => entry.id === 13106);
  assert.deepEqual(ignoredSourceIds(review, 'effects').sort(), ['critical:0:776', 'normal:0:776']);
  assert.equal(review.sourceRecordSha256, '6424e27fd5f8b90f9f2941c8fba9a4e1cf031179b267968d5e99a8d1cc09d784');
  assert.deepEqual(source.effects.map((entry) => entry.effectId), [776, 97]);
  assert.deepEqual(ignoredSourceIds(review, 'scripts'), ['bound:0:16115']);
  assert.equal(semantic(review, 'normal:1:97:target').status, 'SUPPORTED');
  assert.equal(semantic(review, 'critical:1:97:target').status, 'SUPPORTED');
});

test('Concentration keeps invocation-only higher branches ignored and certifies ordinary-target applicability without decoding masks', () => {
  const review = reviews.find((entry) => entry.spellId === 13123);
  const source = sourceTruth.spells.find((entry) => entry.id === 13123);
  const spell = runtime.spells.find((entry) => entry.ankamaId === 13123);
  const curated = applyCuratedSpellRules(spell);
  assert.deepEqual(source.effects.map((entry) => entry.targetMask), ['L,M,l,m,c', 'J,j']);
  assert.deepEqual(ignoredSourceIds(review, 'effects').sort(), ['critical:1:97', 'normal:1:97']);
  assert.deepEqual(ignoredSourceIds(review, 'scripts'), ['bound:0:16118']);
  assert.equal(curated.hits.length, 1);
  assert.deepEqual(curated.hits[0], { element: 'earth', normal: [20, 24], crit: [25, 30] });
});

test('Épée de Iop certifies only the compatible-placement reference application and ignores script 16119 only for T1', () => {
  const review = reviews.find((entry) => entry.spellId === 13125);
  const source = sourceTruth.spells.find((entry) => entry.id === 13125);
  assert.deepEqual(source.effects.map((entry) => entry.effectId), [97]);
  assert.deepEqual(source.criticalEffects.map((entry) => entry.effectId), [97]);
  assert.deepEqual(source.effects.map((entry) => entry.targetMask), ['A,g']);
  assert.deepEqual(ignoredSourceIds(review, 'scripts'), ['bound:0:16119']);
  assert.equal(semantic(review, 'normal:0:97:target').status, 'SUPPORTED');
  assert.match(semantic(review, 'normal:0:97:target').proof, /compatible placement/);
});

test('Pugilat review remains byte-semantically unchanged and unresolved outside the core six', () => {
  const review = reviews.find((entry) => entry.spellId === 13146);
  const source = sourceTruth.spells.find((entry) => entry.id === 13146);
  assert.equal(createHash('sha256').update(JSON.stringify(review)).digest('hex'), '1d02ece3a0e2b50f51939047b97fad514591fbcfe200f56a1584ddb56928b9b4');
  assert.equal(review.sourceRecordSha256, '7cd6529eeeb95a8b687aef410ae1d72892e4a5648349367b4e1f6bc0fa210b6a');
  assert.deepEqual(source.effects.map((entry) => entry.effectId), [97, 293, 406]);
  assert.deepEqual(source.scripts.bound.map((entry) => entry.scriptId), [16122, 16123]);
  assert.equal(validatePlannerSourceCertification('13146', certification(review, source), source).eligible, false);
});

test('Puissance preserves distinct normal/critical Power and ignores Push Damage only because the core six has no pushback attack', () => {
  const review = reviews.find((entry) => entry.spellId === 13118);
  const source = sourceTruth.spells.find((entry) => entry.id === 13118);
  assert.deepEqual(source.effects.map((entry) => [entry.effectId, entry.diceNum, entry.duration]), [[138, 300, 3], [414, 120, 3]]);
  assert.deepEqual(source.criticalEffects.map((entry) => [entry.effectId, entry.diceNum, entry.duration]), [[138, 350, 3], [414, 140, 3]]);
  assert.equal(targetingOf(source).minCastInterval, 4);
  assert.equal(semantic(review, 'normal:0:138:power-buff').amount, 300);
  assert.equal(semantic(review, 'critical:0:138:power-buff').amount, 350);
  assert.notEqual(semantic(review, 'normal:0:138:power-buff').amount, semantic(review, 'critical:0:138:power-buff').amount);
  assert.deepEqual(ignoredSourceIds(review, 'effects').sort(), ['critical:1:414', 'normal:1:414']);
  assert.ok(ignoredSourceEntries(review, 'effects').every((entry) => /six-spell reference pool contains no pushback-damage offensive action/.test(entry.justification)));
  assert.deepEqual(ignoredSourceIds(review, 'scripts'), ['bound:0:16093']);
});

test('Fureur ignores effect 1160 only under the owner-certified future-charge bookkeeping proof', () => {
  const review = reviews.find((entry) => entry.spellId === 13156);
  const source = sourceTruth.spells.find((entry) => entry.id === 13156);
  assert.equal(targetingOf(source).maxCastPerTurn, 1);
  assert.deepEqual(ignoredSourceIds(review, 'effects').sort(), ['critical:1:293', 'critical:2:1160', 'normal:1:293', 'normal:2:1160']);
  const effect1160Proofs = ignoredSourceEntries(review, 'effects').filter((entry) => entry.sourceOccurrenceId.endsWith(':1160'));
  assert.equal(effect1160Proofs.length, 2);
  assert.ok(effect1160Proofs.every((entry) => /bookkeeping\/control of the future Fureur charge/.test(entry.justification)));
  assert.deepEqual(ignoredSourceIds(review, 'scripts'), ['bound:0:16120']);
  assert.equal(semantic(review, 'normal:0:97:target').status, 'SUPPORTED');
});

test('Colère keeps delay=3 future mechanics outside T1 and ignores both scripts only as future-charge bookkeeping', () => {
  const review = reviews.find((entry) => entry.spellId === 13124);
  const source = sourceTruth.spells.find((entry) => entry.id === 13124);
  assert.equal(targetingOf(source).minCastInterval, 3);
  assert.deepEqual(source.effects.map((entry) => [entry.effectId, entry.delay]), [[97, 0], [3793, 3], [293, 3]]);
  assert.deepEqual(ignoredSourceIds(review, 'effects').sort(), ['critical:1:3793', 'critical:2:293', 'normal:1:3793', 'normal:2:293']);
  assert.ok(ignoredSourceEntries(review, 'effects').every((entry) => /delay=3|minCastInterval=3/.test(entry.justification)));
  assert.deepEqual(ignoredSourceIds(review, 'scripts'), ['bound:0:16107', 'bound:1:16121']);
  assert.ok(ignoredSourceEntries(review, 'scripts').every((entry) => /future-charge scheduling\/bookkeeping/.test(entry.justification)));
  assert.equal(semantic(review, 'normal:0:97:target').status, 'SUPPORTED');
});

test('Épée Divine remains deferred and its existing review stays unchanged', () => {
  const review = reviews.find((entry) => entry.spellId === 13110);
  const source = sourceTruth.spells.find((entry) => entry.id === 13110);
  assert.equal(createHash('sha256').update(JSON.stringify(review)).digest('hex'), 'c98dc80fd4aa000e47289e171b11e5aab506fbaa95090bd80bfcb4a0a1329293');
  assert.equal(targetingOf(source).maxCastPerTurn, 2);
  assert.deepEqual(source.effects.map((entry) => [entry.effectId, entry.diceNum, entry.duration]), [[98, 24, 0], [112, 30, 4]]);
  assert.deepEqual(source.criticalEffects.map((entry) => [entry.effectId, entry.diceNum, entry.duration]), [[98, 29, 0], [112, 30, 4]]);
  const buffs = review.effects.flatMap((entry) => entry.semantics).filter((entry) => entry.id.endsWith(':damage-buff'));
  assert.equal(buffs.length, 2);
  assert.ok(buffs.every((entry) => entry.status === 'UNRESOLVED'));
  assert.deepEqual(review.scripts.map((entry) => [entry.scriptId, entry.status]), [[16135, 'UNRESOLVED']]);
});

test('Earth damage arithmetic remains represented independently of scoped applicability', () => {
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
