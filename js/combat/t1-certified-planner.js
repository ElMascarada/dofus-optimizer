import { statsWithCombatModifiers } from '../combat-state.js';
import { spellDamageBreakdown } from '../spells.js';
import {
  SpellEffectSemanticType,
  certifiedPlannerSpellEligibility,
  normalizeSpellEffectSemantics,
  resolveSpellEffectSemantic
} from './spell-effect-semantic.js';
import {
  applyCombatAction,
  cloneCombatState
} from './state.js';
import { validatePlannerSourceCertification } from './source-certification.js';

const EPSILON = 1e-9;
const IMMEDIATE_DAMAGE_ONLY = 'IMMEDIATE_DAMAGE_ONLY';
const DISTINCT_POWER_BUFF_PAYLOADS = 'DISTINCT_POWER_BUFF_PAYLOADS';

function cloneValue(value) {
  if (value === undefined || value === null || typeof value !== 'object') return value;
  return structuredClone(value);
}

function finitePositive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function semanticWalk(effects, visitor) {
  for (const effect of effects || []) {
    visitor(effect);
    if (effect.effect) semanticWalk([effect.effect], visitor);
    if (Array.isArray(effect.effects)) semanticWalk(effect.effects, visitor);
  }
}

function semanticOfType(effects, type) {
  let found = null;
  semanticWalk(effects, (effect) => {
    if (!found && effect.type === type) found = effect;
  });
  return found;
}

function futureStateBranchingEffects(effects) {
  const branching = [];
  semanticWalk(effects, (effect) => {
    if (effect.type === SpellEffectSemanticType.DAMAGE || effect.critical === undefined) return;
    const normal = effect.normal === undefined ? null : effect.normal;
    if (JSON.stringify(normal) !== JSON.stringify(effect.critical)) branching.push(effect);
  });
  return branching;
}

function semanticScope(effect = {}) {
  return effect.target === 'target' || effect.scope === 'target' ? 'target' : 'self';
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function distinctPowerBuffRuntimeSupported(effects) {
  const explicitCriticalEffects = [];
  semanticWalk(effects, (effect) => {
    if (effect.type !== SpellEffectSemanticType.DAMAGE && effect.critical !== undefined) {
      explicitCriticalEffects.push(effect);
    }
  });

  const powerCandidates = explicitCriticalEffects.filter((effect) => {
    if (effect.type !== SpellEffectSemanticType.STAT_MODIFIER || effect.normal === undefined) return false;
    const normal = resolveSpellEffectSemantic(effect, { critical: false });
    const critical = resolveSpellEffectSemantic(effect, { critical: true });
    const normalKeys = Object.keys(normal.stats || {}).sort();
    const criticalKeys = Object.keys(critical.stats || {}).sort();
    return sameValue(normalKeys, ['power']) && sameValue(criticalKeys, ['power']);
  });
  if (powerCandidates.length !== 1) return false;

  const powerEffect = powerCandidates[0];
  const normal = resolveSpellEffectSemantic(powerEffect, { critical: false });
  const critical = resolveSpellEffectSemantic(powerEffect, { critical: true });
  const normalPower = Number(normal.stats?.power);
  const criticalPower = Number(critical.stats?.power);
  if (!Number.isFinite(normalPower) || !Number.isFinite(criticalPower)) return false;
  if (semanticScope(normal) !== 'self' || semanticScope(critical) !== 'self') return false;
  if (String(normal.id || '') !== String(critical.id || '')) return false;
  if (Number(normal.durationTurns ?? normal.duration ?? 1) !== Number(critical.durationTurns ?? critical.duration ?? 1)) return false;
  if (String(normal.stacking || 'replace-source') !== String(critical.stacking || 'replace-source')) return false;

  for (const effect of explicitCriticalEffects) {
    if (effect === powerEffect) continue;
    const normalBranch = effect.normal === undefined ? null : effect.normal;
    if (!sameValue(normalBranch, effect.critical)) return false;
  }
  return true;
}

function runtimeShapeReasons(spell, effects, criticalSemantics) {
  const reasons = [];
  if (!effects.length) reasons.push('RUNTIME_EFFECTS_MISSING');
  if (Array.isArray(spell?.hits) && spell.hits.length > 0
    && !semanticOfType(effects, SpellEffectSemanticType.DAMAGE)) {
    reasons.push('DAMAGE_SEMANTIC_MISSING');
  }
  if ((Number(spell?.maxCastPerTurn || 0) > 0 || Number(spell?.maxCastPerTarget || 0) > 0)
    && !semanticOfType(effects, SpellEffectSemanticType.CAST_LIMIT)) {
    reasons.push('CAST_LIMIT_SEMANTIC_MISSING');
  }
  if (Number(spell?.minCastInterval || 0) > 0
    && !semanticOfType(effects, SpellEffectSemanticType.COOLDOWN)) {
    reasons.push('COOLDOWN_SEMANTIC_MISSING');
  }

  const branching = futureStateBranchingEffects(effects);
  if (criticalSemantics === DISTINCT_POWER_BUFF_PAYLOADS) {
    if (!distinctPowerBuffRuntimeSupported(effects)) reasons.push('CRITICAL_STATE_RUNTIME_UNSUPPORTED');
  } else if (branching.length) {
    reasons.push('CRIT_CHANGES_FUTURE_STATE');
  }

  if (finitePositive(spell?.apCost) <= 0) reasons.push('NON_POSITIVE_AP_COST');
  return reasons;
}

function canonicalSourceSpellId(spell = {}) {
  const value = spell?.ankamaId ?? spell?.id ?? '';
  return String(value || '');
}

function plannerEntry(raw, sourceCertifications = {}, sourceSpells = {}) {
  const spell = raw?.spell || raw;
  const spellId = String(spell?.id || '');
  const sourceSpellId = canonicalSourceSpellId(spell);
  const effects = normalizeSpellEffectSemantics(raw?.effects || spell?.plannerEffects || spell?.effects || []);
  const sourceCertification = raw?.sourceCertification
    || sourceCertifications?.[sourceSpellId]
    || sourceCertifications?.[spellId]
    || null;
  const sourceSpell = raw?.sourceSpell
    || sourceSpells?.[sourceSpellId]
    || sourceSpells?.[spellId]
    || null;
  return { spell, spellId, sourceSpellId, effects, sourceCertification, sourceSpell };
}

function plannerSourceProof(entry) {
  const criticalSemantics = String(entry.sourceCertification?.criticalSemantics || '');
  const certificationForLegacyValidator = criticalSemantics === DISTINCT_POWER_BUFF_PAYLOADS
    ? { ...cloneValue(entry.sourceCertification), criticalSemantics: IMMEDIATE_DAMAGE_ONLY }
    : entry.sourceCertification;
  const result = validatePlannerSourceCertification(
    entry.sourceSpellId,
    certificationForLegacyValidator,
    entry.sourceSpell
  );
  return {
    ...result,
    sourceCertification: cloneValue(entry.sourceCertification || {})
  };
}

export function certifiedT1SpellEligibility(raw, sourceCertifications = {}, sourceSpells = {}) {
  const entry = plannerEntry(raw, sourceCertifications, sourceSpells);
  const criticalSemantics = String(entry.sourceCertification?.criticalSemantics || '');
  const sourceProof = plannerSourceProof(entry);
  const officialGate = certifiedPlannerSpellEligibility({
    effects: entry.effects,
    sourceCertification: entry.sourceCertification || {}
  });
  const shapeReasons = runtimeShapeReasons(entry.spell, entry.effects, criticalSemantics);
  const reasons = [...new Set([
    ...sourceProof.reasons,
    ...officialGate.reasons,
    ...shapeReasons
  ])];
  return {
    eligible: sourceProof.eligible && officialGate.eligible && shapeReasons.length === 0,
    reasons,
    sourceProof,
    officialGate,
    entry
  };
}

function castLimitFor(entry) {
  const semantic = semanticOfType(entry.effects, SpellEffectSemanticType.CAST_LIMIT) || {};
  return {
    perTurn: semantic.perTurn ?? semantic.maxCastPerTurn ?? entry.spell.maxCastPerTurn,
    perTarget: semantic.perTarget ?? semantic.maxCastPerTarget ?? entry.spell.maxCastPerTarget
  };
}

function activeNextCastBaseDamageBonus(state, spellId) {
  let normal = 0;
  let critical = 0;
  let hasModifier = false;
  for (const modifier of Object.values(state?.nextCastModifiers || {})) {
    if (Number(modifier?.appliedTurn || 1) > Number(state?.turn || 1)) continue;
    if (Number(modifier?.expiresAfterTurn || 0) < Number(state?.turn || 1)) continue;
    if (modifier.targetSpellId !== '*' && modifier.targetSpellId !== spellId) continue;
    const normalPayload = modifier.normalPayload || modifier.payload || {};
    const criticalPayload = modifier.criticalPayload || normalPayload;
    const allowedKeys = new Set(['baseDamageBonus']);
    if (Object.keys(normalPayload).some((key) => !allowedKeys.has(key))
      || Object.keys(criticalPayload).some((key) => !allowedKeys.has(key))) {
      return { supported: false, normal: 0, critical: 0 };
    }
    normal += Number(normalPayload.baseDamageBonus || 0);
    critical += Number(criticalPayload.baseDamageBonus ?? normalPayload.baseDamageBonus ?? 0);
    hasModifier = true;
  }
  return { supported: true, normal, critical, hasModifier };
}

function spellWithNextCastDamageBonus(spell, bonus) {
  if (!bonus.hasModifier || (bonus.normal === 0 && bonus.critical === 0)) return spell;
  const hits = Array.isArray(spell?.hits) ? spell.hits : [];
  if (hits.length !== 1) return null;
  const hit = hits[0];
  const normal = Array.isArray(hit.normal) ? hit.normal : [0, 0];
  const critical = Array.isArray(hit.crit) ? hit.crit : normal;
  return {
    ...spell,
    hits: [{
      ...hit,
      normal: [Number(normal[0] || 0) + bonus.normal, Number(normal[1] ?? normal[0] ?? 0) + bonus.normal],
      crit: [Number(critical[0] || 0) + bonus.critical, Number(critical[1] ?? critical[0] ?? 0) + bonus.critical]
    }]
  };
}

function rangeMean(range = [0, 0]) {
  return (Number(range?.[0] || 0) + Number(range?.[1] ?? range?.[0] ?? 0)) / 2;
}

function criticalProbabilityForSpell(spell, effectiveStats, turn) {
  if (Array.isArray(spell?.hits) && spell.hits.length) {
    return spellDamageBreakdown(spell, effectiveStats, turn).critChancePct / 100;
  }
  const probe = {
    ...spell,
    hits: [{ element: 'earth', normal: [0, 0], crit: [0, 0] }]
  };
  return spellDamageBreakdown(probe, effectiveStats, turn).critChancePct / 100;
}

function immediateDamageProfile(entry, state, stats) {
  const effectiveStats = statsWithCombatModifiers(stats, state.activeBuffs || [], state.turn, 'self');
  const bonus = activeNextCastBaseDamageBonus(state, entry.spellId);
  if (!bonus.supported) {
    return { supported: false, expected: 0, normal: 0, critical: 0, critProbability: 0, reason: 'NEXT_CAST_PAYLOAD_UNSUPPORTED' };
  }
  const spell = spellWithNextCastDamageBonus(entry.spell, bonus);
  if (!spell) {
    return { supported: false, expected: 0, normal: 0, critical: 0, critProbability: 0, reason: 'NEXT_CAST_MULTI_HIT_UNSUPPORTED' };
  }
  const breakdown = spellDamageBreakdown(spell, effectiveStats, state.turn);
  const critProbability = criticalProbabilityForSpell(spell, effectiveStats, state.turn);
  const normal = rangeMean(breakdown.normal);
  const critical = rangeMean(breakdown.critical);
  return {
    supported: true,
    expected: normal * (1 - critProbability) + critical * critProbability,
    normal,
    critical,
    critProbability,
    reason: null
  };
}

function actionFor(entry, targetId, critical = false) {
  return {
    spellId: entry.spellId,
    targetId,
    apCost: Number(entry.spell.apCost || 0),
    castLimit: castLimitFor(entry),
    critical: Boolean(critical),
    effects: entry.effects
  };
}

function sequenceKey(sequence = []) {
  return sequence.map((entry) => entry.spellId).join('>');
}

function policyDepth(policy) {
  if (!policy) return 0;
  if (!policy.stochastic) return 1 + policyDepth(policy.continuation);
  return 1 + Math.max(0, ...(policy.branches || []).map((branch) => policyDepth(branch.continuation)));
}

function policyKey(policy) {
  return policy ? JSON.stringify(policy, (key, value) => key === 'stateAfterAction' ? undefined : value) : '';
}

function resultLength(result) {
  return Array.isArray(result.sequence) ? result.sequence.length : policyDepth(result.policy);
}

function resultKey(result) {
  return Array.isArray(result.sequence) ? sequenceKey(result.sequence) : policyKey(result.policy);
}

function betterResult(candidate, best) {
  if (candidate.damage > best.damage + EPSILON) return true;
  if (Math.abs(candidate.damage - best.damage) > EPSILON) return false;
  const candidateLength = resultLength(candidate);
  const bestLength = resultLength(best);
  if (candidateLength !== bestLength) return candidateLength < bestLength;
  return resultKey(candidate).localeCompare(resultKey(best)) < 0;
}

function sameSequence(left, right) {
  return Array.isArray(left) && Array.isArray(right) && sequenceKey(left) === sequenceKey(right);
}

function sameState(left, right) {
  return left && right && JSON.stringify(left) === JSON.stringify(right);
}

function stochasticEntry(entry) {
  return String(entry.sourceCertification?.criticalSemantics || '') === DISTINCT_POWER_BUFF_PAYLOADS;
}

export function planCertifiedT1({
  initialState,
  spells = [],
  sourceCertifications = {},
  sourceSpells = {},
  stats = {},
  availableAp = null,
  targetId = 'default'
} = {}) {
  if (!initialState || typeof initialState !== 'object') throw new Error('Certified T1 planner requires an initial CombatState.');

  const eligible = [];
  const excluded = [];
  for (const raw of spells || []) {
    const eligibility = certifiedT1SpellEligibility(raw, sourceCertifications, sourceSpells);
    if (eligibility.eligible) eligible.push(eligibility.entry);
    else excluded.push({
      spellId: eligibility.entry.spellId,
      name: eligibility.entry.spell?.name || eligibility.entry.spellId,
      reasons: eligibility.reasons
    });
  }

  const root = cloneCombatState(initialState);
  if (availableAp !== null && availableAp !== undefined) {
    const budget = Math.max(0, Number(availableAp || 0));
    root.currentAp = Math.min(root.currentAp, budget);
  }

  let nodesVisited = 0;

  function solve(state) {
    nodesVisited += 1;
    let best = {
      damage: 0,
      sequence: [],
      finalState: cloneCombatState(state),
      policy: null
    };

    for (const entry of eligible) {
      const immediate = immediateDamageProfile(entry, state, stats);
      if (!immediate.supported) continue;

      if (!stochasticEntry(entry)) {
        let transition;
        try {
          transition = applyCombatAction(state, actionFor(entry, targetId, false));
        } catch (error) {
          if (error?.reason) continue;
          throw error;
        }
        const continuation = solve(transition.state);
        const action = { spellId: entry.spellId, name: entry.spell.name || entry.spellId };
        const candidate = {
          damage: immediate.expected + continuation.damage,
          sequence: Array.isArray(continuation.sequence) ? [action, ...continuation.sequence] : null,
          finalState: continuation.finalState,
          policy: {
            type: 'action',
            spellId: action.spellId,
            name: action.name,
            stochastic: false,
            immediateDamage: immediate.expected,
            continuation: continuation.policy
          }
        };
        if (betterResult(candidate, best)) best = candidate;
        continue;
      }

      const p = Math.max(0, Math.min(1, immediate.critProbability));
      const outcomeSpecs = [
        { outcome: 'normal', probability: 1 - p, critical: false, immediateDamage: immediate.normal },
        { outcome: 'critical', probability: p, critical: true, immediateDamage: immediate.critical }
      ];
      const branches = [];
      let actionLegal = true;

      for (const spec of outcomeSpecs) {
        let transition;
        try {
          transition = applyCombatAction(state, actionFor(entry, targetId, spec.critical));
        } catch (error) {
          if (error?.reason) {
            actionLegal = false;
            break;
          }
          throw error;
        }
        const continuation = spec.probability > EPSILON
          ? solve(transition.state)
          : { damage: 0, sequence: [], finalState: cloneCombatState(transition.state), policy: null };
        branches.push({
          outcome: spec.outcome,
          probability: spec.probability,
          immediateDamage: spec.immediateDamage,
          continuationDamage: continuation.damage,
          totalDamage: spec.immediateDamage + continuation.damage,
          stateAfterAction: cloneCombatState(transition.state),
          continuation: continuation.policy,
          sequence: continuation.sequence,
          finalState: continuation.finalState
        });
      }
      if (!actionLegal) continue;

      const expectedDamage = branches.reduce((sum, branch) =>
        sum + branch.probability * branch.totalDamage, 0);
      const relevant = branches.filter((branch) => branch.probability > EPSILON);
      const action = { spellId: entry.spellId, name: entry.spell.name || entry.spellId };
      let sequence = null;
      let finalState = null;
      if (relevant.length === 1 && Array.isArray(relevant[0].sequence)) {
        sequence = [action, ...relevant[0].sequence];
        finalState = relevant[0].finalState;
      } else if (relevant.length === 2 && sameSequence(relevant[0].sequence, relevant[1].sequence)) {
        sequence = [action, ...relevant[0].sequence];
        if (sameState(relevant[0].finalState, relevant[1].finalState)) finalState = relevant[0].finalState;
      }

      const candidate = {
        damage: expectedDamage,
        sequence,
        finalState,
        policy: {
          type: 'action',
          spellId: action.spellId,
          name: action.name,
          stochastic: true,
          criticalSemantics: DISTINCT_POWER_BUFF_PAYLOADS,
          critProbability: p,
          expectedDamage,
          branches: branches.map((branch) => ({
            outcome: branch.outcome,
            probability: branch.probability,
            immediateDamage: branch.immediateDamage,
            continuationDamage: branch.continuationDamage,
            totalDamage: branch.totalDamage,
            stateAfterAction: branch.stateAfterAction,
            continuation: branch.continuation
          }))
        }
      };
      if (betterResult(candidate, best)) best = candidate;
    }
    return best;
  }

  const best = solve(root);
  return {
    damage: best.damage,
    sequence: best.sequence,
    finalState: best.finalState,
    policy: best.policy,
    eligibleSpells: eligible.map((entry) => ({ spellId: entry.spellId, name: entry.spell.name || entry.spellId })),
    excludedSpells: excluded,
    nodesVisited
  };
}
