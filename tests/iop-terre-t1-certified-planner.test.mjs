import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { statsWithCombatModifiers } from '../js/combat-state.js';
import { spellDamageBreakdown } from '../js/spells.js';
import {
  SpellEffectSemanticStatus,
  SpellEffectSemanticType
} from '../js/combat/spell-effect-semantic.js';
import {
  applyCombatAction,
  cloneCombatState,
  createCombatState
} from '../js/combat/state.js';
import {
  createPlannerSourceCertification,
  validatePlannerSourceCertification
} from '../js/combat/source-certification.js';
import {
  certifiedT1SpellEligibility,
  planCertifiedT1
} from '../js/combat/t1-certified-planner.js';

function damageEffect(id = 'damage') {
  return { id, type: SpellEffectSemanticType.DAMAGE, status: SpellEffectSemanticStatus.SUPPORTED };
}

function castLimitEffect(perTurn, perTarget = perTurn) {
  return {
    id: 'cast-limit',
    type: SpellEffectSemanticType.CAST_LIMIT,
    status: SpellEffectSemanticStatus.SUPPORTED,
    perTurn,
    perTarget
  };
}

function certification(spellId, semantics = ['damage', 'ap-cost', 'cast-limits', 'crit']) {
  const sourceEffectIds = semantics.map((semantic) => `fixture:${semantic}`);
  return createPlannerSourceCertification({
    spellId,
    certifiedSemantics: semantics,
    sourceEffectCoverage: {
      sourceEffectIds,
      classifiedEffectIds: sourceEffectIds,
      unresolvedEffectIds: [],
      ignoredEffectIds: []
    },
    evidence: [{
      source: 'fixture:certified-t1-source',
      spellId,
      proof: 'Fixture explicitly declares the complete T1-relevant source semantics used by this test.',
      semantics
    }]
  });
}

function attack({ id, name, apCost, damage, critDamage = damage, baseCritPct = 0, perTurn = 99, perTarget = perTurn }) {
  const spell = {
    id,
    name,
    apCost,
    baseCritPct,
    maxCastPerTurn: perTurn,
    maxCastPerTarget: perTarget,
    hits: [{ element: 'earth', normal: [damage, damage], crit: [critDamage, critDamage] }]
  };
  const effects = [damageEffect(`${id}:damage`), castLimitEffect(perTurn, perTarget)];
  return { spell, effects, sourceCertification: certification(id) };
}

function buff({ id, name, apCost, power, perTurn = 1 }) {
  const spell = { id, name, apCost, baseCritPct: 0, maxCastPerTurn: perTurn, maxCastPerTarget: perTurn, hits: [] };
  const effects = [{
    id: `${id}:power`,
    type: SpellEffectSemanticType.STAT_MODIFIER,
    status: SpellEffectSemanticStatus.SUPPORTED,
    stats: { power },
    durationTurns: 1,
    stacking: 'replace-source'
  }, castLimitEffect(perTurn, perTurn)];
  return {
    spell,
    effects,
    sourceCertification: certification(id, ['buff:power', 'ap-cost', 'cast-limits', 'crit:no-state-change'])
  };
}

function oracleCastLimit(entry) {
  return {
    perTurn: entry.spell.maxCastPerTurn,
    perTarget: entry.spell.maxCastPerTarget
  };
}

function oracleExpectedDamage(entry, state, stats) {
  const effectiveStats = statsWithCombatModifiers(stats, state.activeBuffs || [], state.turn, 'self');
  return spellDamageBreakdown(entry.spell, effectiveStats, state.turn).expected;
}

function bruteForceOracle({ initialState, entries, stats = {}, targetId = 'target' }) {
  let best = { damage: 0, sequence: [] };

  function visit(state, damage, sequence) {
    if (damage > best.damage + 1e-9) best = { damage, sequence: [...sequence] };
    for (const entry of entries) {
      let transition;
      try {
        transition = applyCombatAction(state, {
          spellId: entry.spell.id,
          targetId,
          apCost: entry.spell.apCost,
          castLimit: oracleCastLimit(entry),
          critical: false,
          effects: entry.effects
        });
      } catch (error) {
        if (error?.reason) continue;
        throw error;
      }
      visit(
        transition.state,
        damage + oracleExpectedDamage(entry, state, stats),
        [...sequence, entry.spell.id]
      );
    }
  }

  visit(cloneCombatState(initialState), 0, []);
  return best;
}

test('source certification is positive only with structured, spell-bound reviewable evidence', () => {
  const positive = certification('spell-certified');
  assert.equal(validatePlannerSourceCertification('spell-certified', positive).eligible, true);

  const nakedClaim = {
    spellId: 'spell-certified',
    sourceComplete: true,
    sourceSemanticStatus: 'CERTIFIED',
    certifiedSemantics: ['damage'],
    criticalSemantics: 'IMMEDIATE_DAMAGE_ONLY'
  };
  const negative = validatePlannerSourceCertification('spell-certified', nakedClaim);
  assert.equal(negative.eligible, false);
  assert.ok(negative.reasons.includes('SOURCE_PROOF_MISSING'));
  assert.ok(negative.reasons.includes('SOURCE_CERTIFICATION_SCHEMA_MISSING'));
  assert.ok(negative.reasons.includes('SOURCE_EFFECT_COVERAGE_MISSING'));
});

test('runtime-supported damage is excluded when source semantics remain unresolved', () => {
  const entry = attack({ id: 'spell-unresolved', name: 'Unresolved', apCost: 2, damage: 50, perTurn: 2 });
  entry.sourceCertification = createPlannerSourceCertification({
    spellId: entry.spell.id,
    certifiedSemantics: ['damage', 'ap-cost'],
    unresolvedSemantics: ['secondary-trigger'],
    sourceEffectCoverage: {
      sourceEffectIds: ['normal:0:damage', 'normal:1:secondary-trigger'],
      classifiedEffectIds: ['normal:0:damage'],
      unresolvedEffectIds: ['normal:1:secondary-trigger'],
      ignoredEffectIds: []
    },
    evidence: [{
      source: 'fixture:partial-source',
      spellId: entry.spell.id,
      proof: 'Damage is known but a T1-relevant secondary trigger is deliberately unresolved.',
      semantics: ['damage', 'ap-cost']
    }]
  });

  const eligibility = certifiedT1SpellEligibility(entry);
  assert.equal(eligibility.officialGate.effectSupported, true);
  assert.equal(eligibility.eligible, false);
  assert.ok(eligibility.reasons.includes('SOURCE_SEMANTICS_UNRESOLVED'));

  const result = planCertifiedT1({
    initialState: createCombatState({ baseAp: 6, currentAp: 6 }),
    spells: [entry],
    stats: {}
  });
  assert.deepEqual(result.sequence, []);
  assert.equal(result.damage, 0);
  assert.deepEqual(result.eligibleSpells, []);
});

test('planner enforces AP legality, cast limits and preserves the parent CombatState', () => {
  const strike = attack({ id: 'strike', name: 'Strike', apCost: 3, damage: 40, perTurn: 2 });
  const impossible = attack({ id: 'too-expensive', name: 'Too Expensive', apCost: 9, damage: 999, perTurn: 1 });
  const initialState = createCombatState({ baseAp: 8, currentAp: 8 });
  const snapshot = structuredClone(initialState);

  const result = planCertifiedT1({ initialState, spells: [strike, impossible], stats: {}, availableAp: 8 });
  assert.equal(result.damage, 80);
  assert.deepEqual(result.sequence.map((entry) => entry.spellId), ['strike', 'strike']);
  assert.deepEqual(initialState, snapshot);
  assert.equal(result.finalState.currentAp, 2);
  assert.equal(result.finalState.castsThisTurn.strike, 2);
});

test('cooldown semantics prevent a second same-turn cast even when AP and cast limit remain', () => {
  const entry = attack({ id: 'cooldown-burst', name: 'Cooldown Burst', apCost: 1, damage: 30, perTurn: 5 });
  entry.spell.minCastInterval = 2;
  entry.effects.push({
    id: 'cooldown-burst:cooldown',
    type: SpellEffectSemanticType.COOLDOWN,
    status: SpellEffectSemanticStatus.SUPPORTED,
    intervalTurns: 2
  });
  entry.sourceCertification = certification(entry.spell.id, ['damage', 'ap-cost', 'cast-limits', 'cooldown', 'crit']);

  const result = planCertifiedT1({
    initialState: createCombatState({ baseAp: 5, currentAp: 5 }),
    spells: [entry],
    stats: {}
  });
  assert.equal(result.damage, 30);
  assert.deepEqual(result.sequence.map((item) => item.spellId), ['cooldown-burst']);
});

test('expected critical damage uses exact base crit plus build crit probability', () => {
  const entry = attack({
    id: 'crit-strike',
    name: 'Crit Strike',
    apCost: 2,
    damage: 100,
    critDamage: 200,
    baseCritPct: 10,
    perTurn: 1
  });
  const result = planCertifiedT1({
    initialState: createCombatState({ baseAp: 2, currentAp: 2 }),
    spells: [entry],
    stats: { crit: 20 }
  });
  assert.equal(result.damage, 130);
});

test('exhaustive planner discovers buff-first order and matches an independent brute-force oracle', () => {
  const power = buff({ id: 'power', name: 'Power', apCost: 2, power: 100, perTurn: 1 });
  const strike = attack({ id: 'strike', name: 'Strike', apCost: 3, damage: 40, perTurn: 2 });
  const jab = attack({ id: 'jab', name: 'Jab', apCost: 2, damage: 25, perTurn: 3, perTarget: 1 });
  const entries = [strike, jab, power];
  const initialState = createCombatState({ baseAp: 8, currentAp: 8 });

  const planner = planCertifiedT1({ initialState, spells: entries, stats: {}, targetId: 'target' });
  const oracle = bruteForceOracle({ initialState, entries, stats: {}, targetId: 'target' });

  assert.equal(planner.damage, oracle.damage);
  assert.equal(planner.damage, 160);
  assert.deepEqual(planner.sequence.map((entry) => entry.spellId), ['power', 'strike', 'strike']);
  assert.equal(oracle.damage, 160);
});

test('real priority Iop spells remain source-unresolved and cannot enter the certified planner', async () => {
  const sourceTruth = JSON.parse(await readFile(new URL('../data/normalized/spell-source-truth.json', import.meta.url), 'utf8'));
  const runtimeCatalog = JSON.parse(await readFile(new URL('../data/normalized/spell-data.json', import.meta.url), 'utf8'));
  const priority = new Map([
    [13106, 'Pression'],
    [13123, 'Concentration'],
    [13125, 'Épée de Iop'],
    [13146, 'Pugilat'],
    [13118, 'Puissance'],
    [13138, 'Accumulation']
  ]);

  assert.equal(sourceTruth.coverage.runtimeSupported, 0);
  for (const [ankamaId, name] of priority) {
    const source = sourceTruth.spells.find((entry) => entry.id === ankamaId);
    const runtime = runtimeCatalog.spells.find((entry) => entry.ankamaId === ankamaId);
    assert.ok(source, `missing source truth for ${name}`);
    assert.ok(runtime, `missing runtime catalog spell for ${name}`);
    assert.equal(source.breed.name, 'Iop');
    assert.equal(source.semanticStatus, 'source-unresolved');
    assert.equal(source.runtimeRepresentation.sourceTruthConsumedByRuntime, false);
    assert.ok(source.unresolvedReasons.length > 0, `expected exact blocker for ${name}`);

    const sourceEffectIds = [
      ...(source.effects || []).map((effect, index) => `normal:${index}:${effect.effectId}`),
      ...(source.criticalEffects || []).map((effect, index) => `critical:${index}:${effect.effectId}`)
    ];
    const partialCertification = createPlannerSourceCertification({
      spellId: runtime.id,
      certifiedSemantics: ['runtime-catalog-presence'],
      unresolvedSemantics: source.unresolvedReasons,
      sourceEffectCoverage: {
        sourceEffectIds,
        classifiedEffectIds: [],
        unresolvedEffectIds: sourceEffectIds,
        ignoredEffectIds: []
      },
      evidence: [{
        source: 'data/normalized/spell-source-truth.json',
        spellId: runtime.id,
        proof: `Ankama spell ${ankamaId} (${name}) is preserved but explicitly source-unresolved on this base.`,
        semantics: ['runtime-catalog-presence']
      }]
    });
    const effects = runtime.hits?.length
      ? [damageEffect(`${runtime.id}:runtime-damage`)]
      : [{
          id: `${runtime.id}:runtime-buff-placeholder`,
          type: SpellEffectSemanticType.STAT_MODIFIER,
          status: SpellEffectSemanticStatus.SUPPORTED,
          stats: {}
        }];
    const eligibility = certifiedT1SpellEligibility({ spell: runtime, effects, sourceCertification: partialCertification });
    assert.equal(eligibility.eligible, false, `${name} must not be planner-certified`);
    assert.ok(eligibility.reasons.includes('SOURCE_SEMANTICS_UNRESOLVED'));
  }
});
