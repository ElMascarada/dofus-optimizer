import assert from 'node:assert/strict';
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
  sourceEffectOccurrenceIds,
  validatePlannerSourceCertification
} from '../js/combat/source-certification.js';
import {
  certifiedT1SpellEligibility,
  planCertifiedT1
} from '../js/combat/t1-certified-planner.js';

const DISTINCT_POWER_BUFF_PAYLOADS = 'DISTINCT_POWER_BUFF_PAYLOADS';
const EPSILON = 1e-9;

function castLimitEffect(perTurn = 1, perTarget = perTurn) {
  return {
    id: 'cast-limit',
    type: SpellEffectSemanticType.CAST_LIMIT,
    status: SpellEffectSemanticStatus.SUPPORTED,
    perTurn,
    perTarget
  };
}

function certification(spellId, {
  semantics = ['damage', 'ap-cost', 'cast-limits', 'crit'],
  criticalSemantics = 'IMMEDIATE_DAMAGE_ONLY'
} = {}) {
  const sourceSpell = {
    id: spellId,
    effects: semantics.map((semantic) => ({ effectId: `fixture:${semantic}` })),
    criticalEffects: [],
    scripts: { bound: [] },
    stateReferences: []
  };
  const sourceEffectIds = sourceEffectOccurrenceIds(sourceSpell);
  const sourceCertification = createPlannerSourceCertification({
    spellId,
    sourceSpell,
    certifiedSemantics: semantics,
    criticalSemantics,
    sourceCoverage: {
      effects: { classifiedIds: sourceEffectIds, unresolvedIds: [], ignoredIds: [] },
      scripts: { classifiedIds: [], unresolvedIds: [], ignoredIds: [] },
      states: { classifiedIds: [], unresolvedIds: [], ignoredIds: [] }
    },
    evidence: [{
      source: 'fixture:t1-critical-future-state',
      spellId,
      proof: 'Compact source-bound fixture for certified T1 critical future-state branching.',
      semantics
    }]
  });
  return { sourceSpell, sourceCertification };
}

function attack({
  id,
  name = id,
  apCost = 3,
  element = 'earth',
  damage = 100,
  critDamage = damage,
  baseCritPct = 0,
  perTurn = 1
}) {
  return {
    spell: {
      id,
      name,
      apCost,
      baseCritPct,
      maxCastPerTurn: perTurn,
      maxCastPerTarget: perTurn,
      hits: [{ element, normal: [damage, damage], crit: [critDamage, critDamage] }]
    },
    effects: [
      { id: `${id}:damage`, type: SpellEffectSemanticType.DAMAGE, status: SpellEffectSemanticStatus.SUPPORTED },
      castLimitEffect(perTurn)
    ],
    ...certification(id)
  };
}

function criticalPowerBuff({
  id,
  name = id,
  apCost = 1,
  normalPower,
  criticalPower,
  baseCritPct,
  durationTurns = 3,
  includeCriticalRuntime = true,
  criticalSemantics = DISTINCT_POWER_BUFF_PAYLOADS
}) {
  const powerEffect = {
    id: `${id}:power`,
    type: SpellEffectSemanticType.STAT_MODIFIER,
    status: SpellEffectSemanticStatus.SUPPORTED,
    normal: {
      stats: { power: normalPower },
      durationTurns,
      stacking: 'replace-source'
    }
  };
  if (includeCriticalRuntime) {
    powerEffect.critical = {
      stats: { power: criticalPower },
      durationTurns,
      stacking: 'replace-source'
    };
  }
  return {
    spell: {
      id,
      name,
      apCost,
      baseCritPct,
      maxCastPerTurn: 1,
      maxCastPerTarget: 1,
      hits: []
    },
    effects: [powerEffect, castLimitEffect(1)],
    ...certification(id, {
      semantics: ['buff:power', 'ap-cost', 'cast-limits', 'crit'],
      criticalSemantics
    })
  };
}

function mean(range = [0, 0]) {
  return (Number(range[0] || 0) + Number(range[1] ?? range[0] ?? 0)) / 2;
}

function oracleDamageProfile(entry, state, stats) {
  const effectiveStats = statsWithCombatModifiers(stats, state.activeBuffs || [], state.turn, 'self');
  const breakdown = spellDamageBreakdown(entry.spell, effectiveStats, state.turn);
  const probe = entry.spell.hits?.length
    ? breakdown
    : spellDamageBreakdown({
        ...entry.spell,
        hits: [{ element: 'earth', normal: [0, 0], crit: [0, 0] }]
      }, effectiveStats, state.turn);
  const p = probe.critChancePct / 100;
  return {
    p,
    normal: mean(breakdown.normal),
    critical: mean(breakdown.critical),
    expected: mean(breakdown.normal) * (1 - p) + mean(breakdown.critical) * p
  };
}

function oracleAction(entry, critical, targetId = 'target') {
  return {
    spellId: entry.spell.id,
    targetId,
    apCost: entry.spell.apCost,
    castLimit: {
      perTurn: entry.spell.maxCastPerTurn,
      perTarget: entry.spell.maxCastPerTarget
    },
    critical,
    effects: entry.effects
  };
}

function oraclePolicyKey(policy) {
  if (!policy) return '';
  if (!policy.stochastic) return `${policy.spellId}>${oraclePolicyKey(policy.continuation)}`;
  return `${policy.spellId}{n:${oraclePolicyKey(policy.normal)},c:${oraclePolicyKey(policy.critical)}}`;
}

function oracleDepth(policy) {
  if (!policy) return 0;
  if (!policy.stochastic) return 1 + oracleDepth(policy.continuation);
  return 1 + Math.max(oracleDepth(policy.normal), oracleDepth(policy.critical));
}

function oracleBetter(candidate, best) {
  if (candidate.damage > best.damage + EPSILON) return true;
  if (Math.abs(candidate.damage - best.damage) > EPSILON) return false;
  const candidateDepth = oracleDepth(candidate.policy);
  const bestDepth = oracleDepth(best.policy);
  if (candidateDepth !== bestDepth) return candidateDepth < bestDepth;
  return oraclePolicyKey(candidate.policy).localeCompare(oraclePolicyKey(best.policy)) < 0;
}

function bruteForceAdaptiveOracle({ initialState, entries, stats = {}, targetId = 'target' }) {
  function solve(state) {
    let best = { damage: 0, policy: null };
    for (const entry of entries) {
      const profile = oracleDamageProfile(entry, state, stats);
      const stochastic = entry.sourceCertification.criticalSemantics === DISTINCT_POWER_BUFF_PAYLOADS;
      if (!stochastic) {
        let transition;
        try {
          transition = applyCombatAction(state, oracleAction(entry, false, targetId));
        } catch (error) {
          if (error?.reason) continue;
          throw error;
        }
        const continuation = solve(transition.state);
        const candidate = {
          damage: profile.expected + continuation.damage,
          policy: {
            spellId: entry.spell.id,
            stochastic: false,
            continuation: continuation.policy
          }
        };
        if (oracleBetter(candidate, best)) best = candidate;
        continue;
      }

      const outcomes = {};
      let legal = true;
      for (const [outcome, probability, critical, immediate] of [
        ['normal', 1 - profile.p, false, profile.normal],
        ['critical', profile.p, true, profile.critical]
      ]) {
        let transition;
        try {
          transition = applyCombatAction(state, oracleAction(entry, critical, targetId));
        } catch (error) {
          if (error?.reason) {
            legal = false;
            break;
          }
          throw error;
        }
        const continuation = probability > EPSILON ? solve(transition.state) : { damage: 0, policy: null };
        outcomes[outcome] = {
          probability,
          damage: immediate + continuation.damage,
          continuation: continuation.policy
        };
      }
      if (!legal) continue;
      const candidate = {
        damage: outcomes.normal.probability * outcomes.normal.damage
          + outcomes.critical.probability * outcomes.critical.damage,
        policy: {
          spellId: entry.spell.id,
          stochastic: true,
          normal: outcomes.normal.continuation,
          critical: outcomes.critical.continuation
        }
      };
      if (oracleBetter(candidate, best)) best = candidate;
    }
    return best;
  }
  return solve(cloneCombatState(initialState));
}

function plannerBranch(result, outcome) {
  return result.policy?.branches?.find((branch) => branch.outcome === outcome);
}

function continuationSpellId(branch) {
  return branch?.continuation?.spellId || null;
}

test('source gate accepts DISTINCT_POWER_BUFF_PAYLOADS and unknown critical state remains fail-closed', () => {
  const supported = criticalPowerBuff({
    id: 'source-gate-supported',
    normalPower: 100,
    criticalPower: 150,
    baseCritPct: 25
  });
  const supportedProof = validatePlannerSourceCertification(
    supported.spell.id,
    supported.sourceCertification,
    supported.sourceSpell
  );
  assert.equal(supportedProof.eligible, true);

  const unknown = criticalPowerBuff({
    id: 'source-gate-unknown',
    normalPower: 100,
    criticalPower: 150,
    baseCritPct: 25,
    criticalSemantics: 'SOME_OTHER_FUTURE_STATE'
  });
  const unknownProof = validatePlannerSourceCertification(
    unknown.spell.id,
    unknown.sourceCertification,
    unknown.sourceSpell
  );
  assert.equal(unknownProof.eligible, false);
  assert.ok(unknownProof.reasons.includes('CRITICAL_STATE_SEMANTICS_UNCERTIFIED'));
});

test('case A: distinct Power branches may share the same optimal continuation', () => {
  const buff = criticalPowerBuff({
    id: 'same-continuation-buff',
    normalPower: 100,
    criticalPower: 200,
    baseCritPct: 50
  });
  const strike = attack({ id: 'same-continuation-strike', damage: 100 });
  const initialState = createCombatState({ baseAp: 4, currentAp: 4 });
  const result = planCertifiedT1({ initialState, spells: [buff, strike], stats: {} });

  assert.equal(result.damage, 250);
  assert.equal(result.policy.spellId, buff.spell.id);
  assert.equal(result.policy.stochastic, true);
  assert.equal(continuationSpellId(plannerBranch(result, 'normal')), strike.spell.id);
  assert.equal(continuationSpellId(plannerBranch(result, 'critical')), strike.spell.id);
  assert.deepEqual(result.sequence.map((entry) => entry.spellId), [buff.spell.id, strike.spell.id]);
});

test('case B: observed crit supports different optimal continuations and beats every forced continuation', () => {
  const buff = criticalPowerBuff({
    id: 'adaptive-buff',
    normalPower: 50,
    criticalPower: 350,
    baseCritPct: 50
  });
  const earthHeavy = attack({ id: 'earth-heavy', element: 'earth', damage: 100 });
  const fireHeadStart = attack({ id: 'fire-head-start', element: 'fire', damage: 40 });
  const entries = [buff, earthHeavy, fireHeadStart];
  const initialState = createCombatState({ baseAp: 4, currentAp: 4 });
  const stats = { fire: 500 };

  const planner = planCertifiedT1({ initialState, spells: entries, stats });
  const oracle = bruteForceAdaptiveOracle({ initialState, entries, stats });
  const normal = plannerBranch(planner, 'normal');
  const critical = plannerBranch(planner, 'critical');

  assert.equal(planner.damage, 355);
  assert.equal(planner.policy.spellId, buff.spell.id);
  assert.equal(continuationSpellId(normal), fireHeadStart.spell.id);
  assert.equal(continuationSpellId(critical), earthHeavy.spell.id);
  assert.equal(planner.sequence, null);
  assert.ok(planner.damage > 320, 'adaptive policy must beat the best forced single continuation');

  assert.equal(oracle.damage, planner.damage);
  assert.equal(oracle.policy.spellId, planner.policy.spellId);
  assert.equal(oracle.policy.normal.spellId, continuationSpellId(normal));
  assert.equal(oracle.policy.critical.spellId, continuationSpellId(critical));
});

test('case C: p=0 optimizes only the normal branch', () => {
  const buff = criticalPowerBuff({
    id: 'never-crit-buff',
    normalPower: 100,
    criticalPower: 300,
    baseCritPct: 0
  });
  const strike = attack({ id: 'never-crit-strike', damage: 100 });
  const result = planCertifiedT1({
    initialState: createCombatState({ baseAp: 4, currentAp: 4 }),
    spells: [buff, strike],
    stats: {}
  });

  assert.equal(result.damage, 200);
  assert.equal(plannerBranch(result, 'normal').probability, 1);
  assert.equal(plannerBranch(result, 'critical').probability, 0);
  assert.equal(continuationSpellId(plannerBranch(result, 'normal')), strike.spell.id);
});

test('case D: p=1 optimizes only the critical branch', () => {
  const buff = criticalPowerBuff({
    id: 'always-crit-buff',
    normalPower: 100,
    criticalPower: 300,
    baseCritPct: 100
  });
  const strike = attack({ id: 'always-crit-strike', damage: 100 });
  const result = planCertifiedT1({
    initialState: createCombatState({ baseAp: 4, currentAp: 4 }),
    spells: [buff, strike],
    stats: {}
  });

  assert.equal(result.damage, 400);
  assert.equal(plannerBranch(result, 'normal').probability, 0);
  assert.equal(plannerBranch(result, 'critical').probability, 1);
  assert.equal(continuationSpellId(plannerBranch(result, 'critical')), strike.spell.id);
});

test('case E: immediate-damage-only crit keeps deterministic expected-damage behavior', () => {
  const strike = attack({
    id: 'immediate-only-crit',
    apCost: 2,
    damage: 100,
    critDamage: 200,
    baseCritPct: 10
  });
  const result = planCertifiedT1({
    initialState: createCombatState({ baseAp: 2, currentAp: 2 }),
    spells: [strike],
    stats: { crit: 20 }
  });

  assert.equal(result.damage, 130);
  assert.deepEqual(result.sequence.map((entry) => entry.spellId), [strike.spell.id]);
  assert.equal(result.policy.stochastic, false);
});

test('case F: unsupported critical-state semantic still fails closed', () => {
  const entry = criticalPowerBuff({
    id: 'unsupported-critical-state',
    normalPower: 100,
    criticalPower: 150,
    baseCritPct: 25,
    criticalSemantics: 'UNSUPPORTED_FUTURE_STATE'
  });
  const eligibility = certifiedT1SpellEligibility(entry);
  assert.equal(eligibility.eligible, false);
  assert.ok(eligibility.reasons.includes('CRITICAL_STATE_SEMANTICS_UNCERTIFIED'));
});

test('case G: DISTINCT_POWER_BUFF_PAYLOADS without branch-specific runtime data fails closed', () => {
  const entry = criticalPowerBuff({
    id: 'runtime-mismatch',
    normalPower: 100,
    criticalPower: 150,
    baseCritPct: 25,
    includeCriticalRuntime: false
  });
  const eligibility = certifiedT1SpellEligibility(entry);
  assert.equal(eligibility.eligible, false);
  assert.ok(eligibility.reasons.includes('CRITICAL_STATE_RUNTIME_UNSUPPORTED'));
});

test('Puissance-shaped fixture branches +300/+350 Power at cast-time 25% crit and computes 75/25 expected policy', () => {
  const puissance = criticalPowerBuff({
    id: 'puissance-shaped',
    name: 'Puissance fixture',
    apCost: 3,
    normalPower: 300,
    criticalPower: 350,
    baseCritPct: 25,
    durationTurns: 3
  });
  const strike = attack({ id: 'puissance-follow-up', name: 'Follow-up', apCost: 3, damage: 100 });
  const eligibility = certifiedT1SpellEligibility(puissance);
  assert.equal(eligibility.eligible, true);

  const initialState = createCombatState({ baseAp: 6, currentAp: 6 });
  const planner = planCertifiedT1({ initialState, spells: [puissance, strike], stats: {} });
  const oracle = bruteForceAdaptiveOracle({ initialState, entries: [puissance, strike], stats: {} });
  const normal = plannerBranch(planner, 'normal');
  const critical = plannerBranch(planner, 'critical');

  assert.equal(planner.policy.critProbability, 0.25);
  assert.equal(normal.probability, 0.75);
  assert.equal(critical.probability, 0.25);
  assert.equal(normal.stateAfterAction.activeBuffs[0].stats.power, 300);
  assert.equal(critical.stateAfterAction.activeBuffs[0].stats.power, 350);
  assert.equal(normal.stateAfterAction.activeBuffs[0].expiresAfterTurn, 3);
  assert.equal(critical.stateAfterAction.activeBuffs[0].expiresAfterTurn, 3);
  assert.equal(normal.totalDamage, 400);
  assert.equal(critical.totalDamage, 450);
  assert.equal(planner.damage, 412.5);
  assert.equal(oracle.damage, planner.damage);
});
