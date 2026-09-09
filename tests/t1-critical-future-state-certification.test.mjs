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
  sourceEffectOccurrenceIds
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
      source: 'fixture:t1-critical-final-certification',
      spellId,
      proof: 'Compact source-bound fixture for final critical branching certification.',
      semantics
    }]
  });
  return { sourceSpell, sourceCertification };
}

function attack({ id, apCost = 3, damage = 100, element = 'earth' }) {
  return {
    spell: {
      id,
      name: id,
      apCost,
      baseCritPct: 0,
      maxCastPerTurn: 1,
      maxCastPerTarget: 1,
      hits: [{ element, normal: [damage, damage], crit: [damage, damage] }]
    },
    effects: [
      { id: `${id}:damage`, type: SpellEffectSemanticType.DAMAGE, status: SpellEffectSemanticStatus.SUPPORTED },
      castLimitEffect(1)
    ],
    ...certification(id)
  };
}

function criticalPowerBuff({ id, normalPower, criticalPower, baseCritPct = 50, apCost = 1 }) {
  return {
    spell: {
      id,
      name: id,
      apCost,
      baseCritPct,
      maxCastPerTurn: 1,
      maxCastPerTarget: 1,
      hits: []
    },
    effects: [{
      id: `${id}:power`,
      type: SpellEffectSemanticType.STAT_MODIFIER,
      status: SpellEffectSemanticStatus.SUPPORTED,
      normal: {
        stats: { power: normalPower },
        durationTurns: 3,
        stacking: 'replace-source'
      },
      critical: {
        stats: { power: criticalPower },
        durationTurns: 3,
        stacking: 'replace-source'
      }
    }, castLimitEffect(1)],
    ...certification(id, {
      semantics: ['buff:power', 'ap-cost', 'cast-limits', 'crit'],
      criticalSemantics: DISTINCT_POWER_BUFF_PAYLOADS
    })
  };
}

function statBuff({ id, stat, amount, apCost = 1 }) {
  return {
    spell: {
      id,
      name: id,
      apCost,
      baseCritPct: 0,
      maxCastPerTurn: 1,
      maxCastPerTarget: 1,
      hits: []
    },
    effects: [{
      id: `${id}:${stat}`,
      type: SpellEffectSemanticType.STAT_MODIFIER,
      status: SpellEffectSemanticStatus.SUPPORTED,
      stats: { [stat]: amount },
      durationTurns: 1,
      stacking: 'replace-source'
    }, castLimitEffect(1)],
    ...certification(id, {
      semantics: [`buff:${stat}`, 'ap-cost', 'cast-limits', 'crit:no-state-change']
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
    castLimit: { perTurn: entry.spell.maxCastPerTurn, perTarget: entry.spell.maxCastPerTarget },
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
          policy: { spellId: entry.spell.id, stochastic: false, continuation: continuation.policy }
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

function plannerBranch(policy, outcome) {
  return policy?.branches?.find((branch) => branch.outcome === outcome);
}

test('DISTINCT_POWER_BUFF_PAYLOADS rejects equal normal and critical Power', () => {
  const entry = criticalPowerBuff({ id: 'equal-power', normalPower: 200, criticalPower: 200 });
  const eligibility = certifiedT1SpellEligibility(entry);
  assert.equal(eligibility.eligible, false);
  assert.ok(eligibility.reasons.includes('CRITICAL_STATE_RUNTIME_UNSUPPORTED'));
});

test('DISTINCT_POWER_BUFF_PAYLOADS rejects any extra branch-specific structural difference', () => {
  const entry = criticalPowerBuff({ id: 'extra-branch-field', normalPower: 200, criticalPower: 250 });
  entry.effects[0].normal.ownerMarker = 'normal';
  entry.effects[0].critical.ownerMarker = 'critical';
  const eligibility = certifiedT1SpellEligibility(entry);
  assert.equal(eligibility.eligible, false);
  assert.ok(eligibility.reasons.includes('CRITICAL_STATE_RUNTIME_UNSUPPORTED'));
});

test('stochastic exact tie uses the same canonical structural key as the independent oracle', () => {
  const zRoot = criticalPowerBuff({ id: 'z-root', normalPower: 100, criticalPower: 200 });
  const aRoot = criticalPowerBuff({ id: 'a-root', normalPower: 100, criticalPower: 200 });
  const zContinuation = attack({ id: 'z-cont', damage: 100 });
  const aContinuation = attack({ id: 'a-cont', damage: 100 });
  const entries = [zRoot, aRoot, zContinuation, aContinuation];
  const initialState = createCombatState({ baseAp: 4, currentAp: 4 });

  const planner = planCertifiedT1({ initialState, spells: entries, stats: {} });
  const oracle = bruteForceAdaptiveOracle({ initialState, entries, stats: {} });
  const plannerNormal = plannerBranch(planner.policy, 'normal');
  const plannerCritical = plannerBranch(planner.policy, 'critical');

  assert.equal(planner.damage, oracle.damage);
  assert.equal(planner.policy.spellId, 'a-root');
  assert.equal(oracle.policy.spellId, 'a-root');
  assert.equal(plannerNormal.continuation.spellId, 'a-cont');
  assert.equal(plannerCritical.continuation.spellId, 'a-cont');
  assert.equal(oracle.policy.normal.spellId, 'a-cont');
  assert.equal(oracle.policy.critical.spellId, 'a-cont');
});

test('DISTINCT_POWER_BUFF_PAYLOADS crit probability is read from CombatState at cast time', () => {
  const critPrimer = statBuff({ id: 'crit-primer', stat: 'crit', amount: 50, apCost: 1 });
  const stochastic = criticalPowerBuff({
    id: 'cast-time-power',
    normalPower: 0,
    criticalPower: 400,
    baseCritPct: 0,
    apCost: 1
  });
  const strike = attack({ id: 'cast-time-strike', apCost: 3, damage: 100 });
  const initialState = createCombatState({ baseAp: 5, currentAp: 5 });

  const planner = planCertifiedT1({ initialState, spells: [stochastic, strike, critPrimer], stats: {} });
  assert.equal(planner.policy.spellId, 'crit-primer');
  assert.equal(planner.policy.stochastic, false);
  const stochasticPolicy = planner.policy.continuation;
  assert.equal(stochasticPolicy.spellId, 'cast-time-power');
  assert.equal(stochasticPolicy.stochastic, true);
  assert.equal(stochasticPolicy.critProbability, 0.5);
  assert.equal(plannerBranch(stochasticPolicy, 'normal').probability, 0.5);
  assert.equal(plannerBranch(stochasticPolicy, 'critical').probability, 0.5);
});
