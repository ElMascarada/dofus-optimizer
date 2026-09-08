import { statsWithCombatModifiers } from '../combat-state.js';
import { spellDamageBreakdown } from '../spells.js';
import {
  SpellEffectSemanticType,
  certifiedPlannerSpellEligibility,
  normalizeSpellEffectSemantics
} from './spell-effect-semantic.js';
import {
  applyCombatAction,
  cloneCombatState
} from './state.js';
import { validatePlannerSourceCertification } from './source-certification.js';

const EPSILON = 1e-9;

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

function hasBranchingFutureState(effects) {
  let branching = false;
  semanticWalk(effects, (effect) => {
    if (branching || effect.type === SpellEffectSemanticType.DAMAGE) return;
    if (effect.critical === undefined) return;
    const normal = effect.normal === undefined ? null : effect.normal;
    if (JSON.stringify(normal) !== JSON.stringify(effect.critical)) branching = true;
  });
  return branching;
}

function runtimeShapeReasons(spell, effects) {
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
  if (hasBranchingFutureState(effects)) reasons.push('CRIT_CHANGES_FUTURE_STATE');
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

export function certifiedT1SpellEligibility(raw, sourceCertifications = {}, sourceSpells = {}) {
  const entry = plannerEntry(raw, sourceCertifications, sourceSpells);
  const sourceProof = validatePlannerSourceCertification(
    entry.sourceSpellId,
    entry.sourceCertification,
    entry.sourceSpell
  );
  const officialGate = certifiedPlannerSpellEligibility({
    effects: entry.effects,
    sourceCertification: entry.sourceCertification || {}
  });
  const shapeReasons = runtimeShapeReasons(entry.spell, entry.effects);
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

function expectedImmediateDamage(entry, state, stats) {
  const effectiveStats = statsWithCombatModifiers(stats, state.activeBuffs || [], state.turn, 'self');
  const bonus = activeNextCastBaseDamageBonus(state, entry.spellId);
  if (!bonus.supported) return { supported: false, damage: 0, reason: 'NEXT_CAST_PAYLOAD_UNSUPPORTED' };
  const spell = spellWithNextCastDamageBonus(entry.spell, bonus);
  if (!spell) return { supported: false, damage: 0, reason: 'NEXT_CAST_MULTI_HIT_UNSUPPORTED' };
  return {
    supported: true,
    damage: spellDamageBreakdown(spell, effectiveStats, state.turn).expected,
    reason: null
  };
}

function actionFor(entry, targetId) {
  return {
    spellId: entry.spellId,
    targetId,
    apCost: Number(entry.spell.apCost || 0),
    castLimit: castLimitFor(entry),
    critical: false,
    effects: entry.effects
  };
}

function sequenceKey(sequence) {
  return sequence.map((entry) => entry.spellId).join('>');
}

function betterResult(candidate, best) {
  if (candidate.damage > best.damage + EPSILON) return true;
  if (Math.abs(candidate.damage - best.damage) > EPSILON) return false;
  if (candidate.sequence.length !== best.sequence.length) return candidate.sequence.length < best.sequence.length;
  return sequenceKey(candidate.sequence).localeCompare(sequenceKey(best.sequence)) < 0;
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
  let best = { damage: 0, sequence: [], finalState: cloneCombatState(root) };

  function visit(state, sequence, damage) {
    nodesVisited += 1;
    const current = { damage, sequence, finalState: cloneCombatState(state) };
    if (betterResult(current, best)) best = current;

    for (const entry of eligible) {
      const immediate = expectedImmediateDamage(entry, state, stats);
      if (!immediate.supported) continue;
      let transition;
      try {
        transition = applyCombatAction(state, actionFor(entry, targetId));
      } catch (error) {
        if (error?.reason) continue;
        throw error;
      }
      visit(
        transition.state,
        [...sequence, { spellId: entry.spellId, name: entry.spell.name || entry.spellId }],
        damage + immediate.damage
      );
    }
  }

  visit(root, [], 0);
  return {
    damage: best.damage,
    sequence: best.sequence,
    finalState: best.finalState,
    eligibleSpells: eligible.map((entry) => ({ spellId: entry.spellId, name: entry.spell.name || entry.spellId })),
    excludedSpells: excluded,
    nodesVisited
  };
}
