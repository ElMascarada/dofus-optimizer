export const SpellEffectSemanticStatus = Object.freeze({
  SUPPORTED: 'SUPPORTED',
  UNRESOLVED: 'UNRESOLVED'
});

export const SpellEffectSemanticType = Object.freeze({
  DAMAGE: 'damage',
  STAT_MODIFIER: 'stat_modifier',
  STATE: 'state',
  TRIGGER: 'trigger',
  CHARGE: 'charge',
  NEXT_CAST_MODIFIER: 'next_cast_modifier',
  DELAYED_EFFECT: 'delayed_effect',
  COOLDOWN: 'cooldown',
  CAST_LIMIT: 'cast_limit',
  CONDITION: 'condition',
  TARGET: 'target',
  MOVEMENT: 'movement'
});

const KNOWN_TYPES = new Set(Object.values(SpellEffectSemanticType));
const KNOWN_STATUSES = new Set(Object.values(SpellEffectSemanticStatus));

const COMBAT_EFFECT_ALIASES = Object.freeze({
  Damage: SpellEffectSemanticType.DAMAGE,
  StatModifier: SpellEffectSemanticType.STAT_MODIFIER,
  TargetModifier: SpellEffectSemanticType.STAT_MODIFIER,
  State: SpellEffectSemanticType.STATE,
  ConsumeState: SpellEffectSemanticType.STATE,
  SpellCharge: SpellEffectSemanticType.CHARGE,
  DelayedEffect: SpellEffectSemanticType.DELAYED_EFFECT,
  Cooldown: SpellEffectSemanticType.COOLDOWN,
  CastLimit: SpellEffectSemanticType.CAST_LIMIT,
  Conditional: SpellEffectSemanticType.CONDITION
});

function cloneValue(value) {
  if (value === undefined || value === null || typeof value !== 'object') return value;
  return structuredClone(value);
}

function normalizedType(value) {
  const raw = String(value || '').trim();
  if (KNOWN_TYPES.has(raw)) return raw;
  const alias = COMBAT_EFFECT_ALIASES[raw];
  if (alias) return alias;
  throw new Error(`Unsupported spell effect semantic type: ${raw || '<empty>'}`);
}

function normalizedStatus(value) {
  const raw = String(value || '').trim().toUpperCase();
  if (KNOWN_STATUSES.has(raw)) return raw;
  throw new Error(`Unsupported spell effect semantic status: ${raw || '<empty>'}`);
}

function normalizeOne(effect = {}, inheritedStatus = null) {
  const type = normalizedType(effect.type);
  const explicitStatus = effect.status ?? effect.semanticStatus ?? null;
  const status = normalizedStatus(explicitStatus ?? inheritedStatus ?? SpellEffectSemanticStatus.UNRESOLVED);
  const normalized = cloneValue({ ...effect, type, status });

  if (normalized.effect) normalized.effect = normalizeOne(normalized.effect, status);
  if (Array.isArray(normalized.effects)) {
    normalized.effects = normalized.effects.map((entry) => normalizeOne(entry, status));
  }
  return normalized;
}

export function normalizeSpellEffectSemantic(effect = {}) {
  return normalizeOne(effect);
}

export function normalizeSpellEffectSemantics(effects = []) {
  return (effects || []).map((effect) => normalizeSpellEffectSemantic(effect));
}

export function spellEffectSemanticFromCombatEffect(effect = {}) {
  const sourceType = String(effect.type || '');
  const type = sourceType === 'SpellCharge'
    ? SpellEffectSemanticType.NEXT_CAST_MODIFIER
    : normalizedType(sourceType);
  const semantic = cloneValue({
    ...effect,
    type,
    status: SpellEffectSemanticStatus.SUPPORTED
  });

  if (sourceType === 'TargetModifier') semantic.target = semantic.target || 'target';
  if (sourceType === 'ConsumeState') semantic.operation = 'consume';
  if (sourceType === 'SpellCharge') {
    const normalBonus = Number(effect.baseDamageBonus || 0);
    const criticalBonus = Number.isFinite(Number(effect.critBaseDamageBonus))
      ? Number(effect.critBaseDamageBonus)
      : normalBonus;
    semantic.normal = { payload: { baseDamageBonus: normalBonus } };
    semantic.critical = { payload: { baseDamageBonus: criticalBonus } };
  }
  return normalizeOne(semantic, SpellEffectSemanticStatus.SUPPORTED);
}

export function spellEffectSemanticsFromCombatEffects(effects = []) {
  return (effects || []).map((effect) => spellEffectSemanticFromCombatEffect(effect));
}

function visitSemantic(effect, visitor) {
  visitor(effect);
  if (effect.effect) visitSemantic(effect.effect, visitor);
  for (const nested of effect.effects || []) visitSemantic(nested, visitor);
}

export function unresolvedRelevantSpellSemantics(effects = []) {
  const unresolved = [];
  for (const root of normalizeSpellEffectSemantics(effects)) {
    visitSemantic(root, (effect) => {
      if (effect.status === SpellEffectSemanticStatus.UNRESOLVED && effect.relevantToPlan !== false) {
        unresolved.push(effect);
      }
    });
  }
  return unresolved;
}

export function certifiedSpellSemanticEligibility(effects = []) {
  const normalized = normalizeSpellEffectSemantics(effects);
  const unresolved = unresolvedRelevantSpellSemantics(normalized);
  return {
    eligible: unresolved.length === 0,
    effects: normalized,
    unresolved
  };
}

export class UnresolvedSpellSemanticError extends Error {
  constructor(unresolved = []) {
    const labels = unresolved.map((effect) => String(effect.id || effect.type || 'unknown')).join(', ');
    super(`Certified planner cannot activate unresolved spell semantics: ${labels || 'unknown'}`);
    this.name = 'UnresolvedSpellSemanticError';
    this.unresolved = unresolved.map((effect) => cloneValue(effect));
  }
}

export function assertCertifiedSpellSemantics(effects = []) {
  const result = certifiedSpellSemanticEligibility(effects);
  if (!result.eligible) throw new UnresolvedSpellSemanticError(result.unresolved);
  return result.effects;
}

export function resolveSpellEffectSemantic(effect = {}, { critical = false } = {}) {
  const normalized = normalizeSpellEffectSemantic(effect);
  const branch = critical
    ? (normalized.critical ?? normalized.normal)
    : normalized.normal;

  if (branch === undefined) return normalized;

  const resolved = cloneValue(normalized);
  delete resolved.normal;
  delete resolved.critical;

  if (branch && typeof branch === 'object' && !Array.isArray(branch)) {
    return normalizeOne({ ...resolved, ...cloneValue(branch) }, resolved.status);
  }
  return normalizeOne({ ...resolved, value: cloneValue(branch) }, resolved.status);
}
