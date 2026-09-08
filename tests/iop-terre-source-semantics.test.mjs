import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
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

function sortedValue(value) {
  if (Array.isArray(value)) return value.map(sortedValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortedValue(value[key])]));
  }
  return value;
}

function certification(review, source) {
  const semantics = review.effects.flatMap((entry) => entry.semantics);
  const supported = semantics.filter((entry) => entry.status === 'SUPPORTED');
  return createPlannerSourceCertification({
    spellId: String(review.spellId),
    sourceSpell: source,
    certifiedSemantics: supported.map((entry) => entry.id),
    unresolvedSemantics: [
      ...semantics.filter((entry) => entry.status === 'UNRESOLVED').map((entry) => entry.id),
      ...review.scripts.map((entry) => entry.sourceOccurrenceId)
    ],
    criticalSemantics: review.criticalSemantics,
    sourceCoverage: Object.fromEntries(['effects', 'scripts', 'states'].map((kind) => [kind, {
      classifiedIds: review[kind].filter((entry) => entry.status === 'SUPPORTED').map((entry) => entry.sourceOccurrenceId),
      unresolvedIds: review[kind].filter((entry) => entry.status === 'UNRESOLVED').map((entry) => entry.sourceOccurrenceId),
      ignoredIds: []
    }])),
    evidence: supported.map((entry) => ({
      source: 'data/normalized/spell-source-truth.json + js/dofus-spell-normalizer.js + js/spells.js',
      spellId: String(review.spellId),
      proof: entry.proof,
      semantics: [entry.id]
    }))
  });
}

test('Iop Terre semantic review is limited to Pression, Concentration, Épée de Iop and Pugilat', () => {
  assert.deepEqual(reviews.map((entry) => entry.spellId), [13106, 13123, 13125, 13146]);
});

const expectedOccurrenceCounts = new Map([
  [13106, { effects: 4, scripts: 1, states: 0 }],
  [13123, { effects: 4, scripts: 1, states: 0 }],
  [13125, { effects: 2, scripts: 1, states: 0 }],
  [13146, { effects: 6, scripts: 2, states: 0 }]
]);

for (const review of reviews) {
  const source = sourceTruth.spells.find((entry) => entry.id === review.spellId);
  const spell = runtime.spells.find((entry) => entry.ankamaId === review.spellId);

  test(`${review.name}: every normal, critical, script and state occurrence is explicitly reviewed`, () => {
    const hash = createHash('sha256').update(JSON.stringify(sortedValue(source))).digest('hex');
    assert.equal(hash, review.sourceRecordSha256, 'any source shape/metadata change requires semantic re-review');
    assert.deepEqual(review.effects.map((entry) => entry.sourceOccurrenceId), sourceEffectOccurrenceIds(source));
    assert.deepEqual(review.scripts.map((entry) => entry.sourceOccurrenceId), sourceBoundScriptOccurrenceIds(source));
    assert.deepEqual(review.states.map((entry) => entry.sourceOccurrenceId), sourceStateReferenceOccurrenceIds(source));
    const expected = expectedOccurrenceCounts.get(review.spellId);
    assert.equal(review.effects.length, expected.effects);
    assert.equal(review.scripts.length, expected.scripts);
    assert.equal(review.states.length, expected.states);
    assert.deepEqual(source.stateReferences, []);
    for (const script of source.scripts.bound) {
      assert.equal(script.scriptMetadata, null);
      assert.equal(script.metadataJoinStatus, 'missing');
    }
    for (const [index, entry] of review.effects.entries()) {
      const raw = [...source.effects, ...source.criticalEffects][index];
      assert.equal(entry.effectId, raw.effectId);
      assert.equal(entry.sourceOrder, raw.order);
      assert.equal(raw.metadataJoinStatus, 'joined');
      assert.equal(raw.effectMetadata.id, raw.effectId);
      const semantics = normalizeSpellEffectSemantics(entry.semantics);
      assert.ok(semantics.length > 0);
      assert.equal(entry.status, 'UNRESOLVED');
      for (const semantic of semantics) {
        assert.ok(semantic.proof.length > 0);
        if (semantic.status === 'UNRESOLVED') assert.ok(semantic.missingRuntimePrimitive.length > 0);
      }
      const target = semantics.find((semantic) => semantic.type === 'target');
      assert.equal(target.status, 'UNRESOLVED');
      assert.equal(target.sourceMask, raw.targetMask);
    }
  });

  test(`${review.name}: isolated Earth damage arithmetic is represented, not target applicability`, () => {
    const normal = source.effects.filter((entry) => entry.effectId === 97);
    const critical = source.criticalEffects.filter((entry) => entry.effectId === 97);
    assert.equal(normal.length, critical.length);
    for (const [index, effect] of normal.entries()) {
      const crit = critical[index];
      assert.equal(effect.targetMask, crit.targetMask);
      for (const row of [effect, crit]) {
        assert.equal(row.effectMetadata.elementId, 1);
        assert.equal(row.effectMetadata.category, 2);
        assert.equal(row.effectMetadata.useInFight, 1);
        assert.equal(row.effectMetadata.useDice, 1);
        assert.match(row.sourceDescription, /dommages Terre/);
        assert.equal(row.triggers, 'I');
        assert.equal(row.duration, 0);
        assert.equal(row.delay, 0);
        assert.equal(row.random, 0);
        const reviewed = review.effects.find((entry) => entry.sourceOrder === row.order);
        const damage = reviewed.semantics.find((entry) => entry.type === 'damage');
        assert.equal(damage.status, 'SUPPORTED');
        assert.deepEqual(damage.range, [row.diceNum, row.diceSide]);
      }
      const projected = { hits: [{ element: 'earth', normal: [effect.diceNum, effect.diceSide], crit: [crit.diceNum, crit.diceSide] }] };
      const plain = spellDamageBreakdown(projected, {});
      assert.deepEqual(plain.normal, projected.hits[0].normal);
      assert.deepEqual(plain.critical, projected.hits[0].crit);
      const scaled = spellDamageBreakdown(projected, { earth: 100, damage: 7, critDamage: 3 });
      assert.deepEqual(scaled.normal, projected.hits[0].normal.map((value) => value * 2 + 7));
      assert.deepEqual(scaled.critical, projected.hits[0].crit.map((value) => value * 2 + 10));
    }
  });

  test(`${review.name}: complete occurrence accounting does not certify an unresolved spell`, () => {
    const proof = certification(review, source);
    assert.equal(proof.sourceComplete, false);
    assert.equal(proof.sourceSemanticStatus, 'UNRESOLVED');
    const validation = validatePlannerSourceCertification(String(review.spellId), proof, source);
    assert.equal(validation.eligible, false);
    assert.ok(validation.reasons.includes('SOURCE_EFFECTS_UNRESOLVED'));
    assert.ok(validation.reasons.includes('SOURCE_SCRIPTS_UNRESOLVED'));
    assert.ok(!validation.reasons.some((reason) => /COVERAGE_(INCOMPLETE|EXTRA|OVERLAP|SOURCE_MISMATCH)/.test(reason)));
    for (const kind of ['effects', 'scripts', 'states']) assert.deepEqual(proof.sourceCoverage[kind].ignoredIds, []);
    const eligibility = certifiedT1SpellEligibility({
      spell,
      sourceSpell: source,
      sourceCertification: proof,
      effects: review.effects.flatMap((entry) => entry.semantics)
    });
    assert.equal(eligibility.eligible, false);
    assert.ok(eligibility.reasons.includes('UNRESOLVED_RUNTIME_EFFECTS'));
    const changedSource = structuredClone(source);
    changedSource.scripts.bound.push({ scriptId: 999999 });
    assert.ok(validatePlannerSourceCertification(String(review.spellId), proof, changedSource).reasons.includes('SOURCE_SCRIPT_COVERAGE_INCOMPLETE'));
  });
}

test('Pression erosion is identified by metadata but not reclassified as an irrelevant T1 effect', () => {
  const source = sourceTruth.spells.find((entry) => entry.id === 13106);
  const rows = [...source.effects, ...source.criticalEffects].filter((entry) => entry.effectId === 776);
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.match(row.sourceDescription, /Érosion/);
    assert.equal(row.diceNum, 10);
    assert.equal(row.duration, 2);
    assert.equal(row.triggers, 'I');
  }
  const erosion = reviews[0].effects.flatMap((entry) => entry.semantics).filter((entry) => entry.type === 'stat_modifier');
  assert.equal(erosion.length, 2);
  assert.ok(erosion.every((entry) => entry.status === 'UNRESOLVED'));
});

test('Concentration existing first-hit curation is preserved without certifying source target masks', () => {
  const source = sourceTruth.spells.find((entry) => entry.id === 13123);
  const spell = runtime.spells.find((entry) => entry.ankamaId === 13123);
  const curated = applyCuratedSpellRules(spell);
  assert.deepEqual(source.effects.map((entry) => entry.targetMask), ['L,M,l,m,c', 'J,j']);
  assert.equal(curated.hits.length, 1);
  assert.deepEqual(curated.hits[0], { element: 'earth', normal: [20, 24], crit: [25, 30] });
  assert.ok(reviews[1].effects.every((entry) => entry.status === 'UNRESOLVED'));
});

test('Épée de Iop keeps target-zone applicability and bound script 16119 unresolved', () => {
  const review = reviews.find((entry) => entry.spellId === 13125);
  const source = sourceTruth.spells.find((entry) => entry.id === 13125);
  assert.deepEqual(source.effects.map((entry) => entry.effectId), [97]);
  assert.deepEqual(source.criticalEffects.map((entry) => entry.effectId), [97]);
  assert.deepEqual(source.effects.map((entry) => entry.targetMask), ['A,g']);
  assert.deepEqual(source.criticalEffects.map((entry) => entry.targetMask), ['A,g']);
  assert.equal(source.effects[0].zoneDescr.shape, 88);
  assert.equal(source.effects[0].zoneDescr.param1, 3);
  assert.deepEqual(review.scripts.map((entry) => entry.scriptId), [16119]);
  assert.ok(review.scripts.every((entry) => entry.status === 'UNRESOLVED'));
  assert.ok(review.effects.flatMap((entry) => entry.semantics).filter((entry) => entry.type === 'target').every((entry) => entry.status === 'UNRESOLVED'));
});

test('Pugilat effect 293, effect 406 TE trigger and bound scripts remain unresolved', () => {
  const review = reviews.find((entry) => entry.spellId === 13146);
  const source = sourceTruth.spells.find((entry) => entry.id === 13146);
  assert.deepEqual(source.effects.map((entry) => entry.effectId), [97, 293, 406]);
  assert.deepEqual(source.criticalEffects.map((entry) => entry.effectId), [97, 293, 406]);
  assert.deepEqual(source.scripts.bound.map((entry) => entry.scriptId), [16122, 16123]);
  const effect293 = review.effects.filter((entry) => entry.effectId === 293);
  assert.equal(effect293.length, 2);
  assert.ok(effect293.every((entry) => entry.status === 'UNRESOLVED'));
  assert.ok(effect293.flatMap((entry) => entry.semantics).filter((entry) => entry.type === 'next_cast_modifier').every((entry) => entry.status === 'UNRESOLVED'));
  const effect406 = review.effects.filter((entry) => entry.effectId === 406);
  assert.equal(effect406.length, 2);
  assert.ok(effect406.every((entry) => entry.status === 'UNRESOLVED'));
  for (const entry of effect406) {
    const trigger = entry.semantics.find((semantic) => semantic.type === 'trigger');
    assert.equal(trigger.status, 'UNRESOLVED');
    assert.equal(trigger.trigger, 'TE');
  }
  assert.ok(review.scripts.every((entry) => entry.status === 'UNRESOLVED'));
});
