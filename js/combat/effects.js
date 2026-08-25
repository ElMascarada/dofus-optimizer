import { applyTimedModifiers } from '../combat-state.js';

export const CombatEffectType = Object.freeze({
  DAMAGE: 'Damage',
  STAT_MODIFIER: 'StatModifier',
  TARGET_MODIFIER: 'TargetModifier',
  DELAYED_EFFECT: 'DelayedEffect',
  SPELL_CHARGE: 'SpellCharge',
  STATE: 'State',
  CONSUME_STATE: 'ConsumeState',
  COOLDOWN: 'Cooldown',
  CAST_LIMIT: 'CastLimit',
  CONDITIONAL: 'Conditional'
});

const KNOWN_TYPES = new Set(Object.values(CombatEffectType));

function num(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function positiveInt(value, fallback = 1) {
  return Math.max(1, Math.floor(num(value, fallback)));
}

function cloneEffect(effect = {}) {
  const cloned = { ...effect };
  if (effect.stats) cloned.stats = { ...effect.stats };
  if (effect.effect) cloned.effect = cloneEffect(effect.effect);
  if (Array.isArray(effect.effects)) cloned.effects = effect.effects.map(cloneEffect);
  if (Array.isArray(effect.hits)) cloned.hits = effect.hits.map((hit) => ({
    ...hit,
    normal: Array.isArray(hit.normal) ? [...hit.normal] : hit.normal,
    crit: Array.isArray(hit.crit) ? [...hit.crit] : hit.crit
  }));
  return cloned;
}

export function normalizeCombatEffect(effect = {}) {
  const type = String(effect?.type || '');
  if (!KNOWN_TYPES.has(type)) throw new Error(`Unsupported combat effect type: ${type || '<empty>'}`);
  return cloneEffect({ ...effect, type });
}

function modifierEffect(modifier = {}) {
  const scope = modifier.scope === 'target' ? 'target' : 'self';
  return {
    type: scope === 'target' ? CombatEffectType.TARGET_MODIFIER : CombatEffectType.STAT_MODIFIER,
    id: modifier.id,
    stats: { ...(modifier.stats || {}) },
    durationTurns: positiveInt(modifier.durationTurns || modifier.duration || 1),
    stacking: modifier.stacking || 'replace-source',
    description: modifier.description,
    sourceEffectId: modifier.sourceEffectId
  };
}

export function spellCombatEffects(spell = {}) {
  const effects = [];
  if ((spell.hits || []).length) {
    effects.push({
      type: CombatEffectType.DAMAGE,
      id: `${spell.id || 'spell'}:damage`,
      hits: cloneEffect({ hits: spell.hits }).hits,
      selection: spell.damageSelection || 'all'
    });
  }
  for (const modifier of spell.combatModifiers || []) effects.push(modifierEffect(modifier));
  for (const modifier of spell.delayedCombatModifiers || []) {
    effects.push({
      type: CombatEffectType.DELAYED_EFFECT,
      id: modifier.id,
      delayTurns: Math.max(0, num(modifier.delayTurns, 0)),
      effect: modifierEffect({ ...modifier, delayTurns: 0 })
    });
  }
  if (spell.selfCharge) {
    effects.push({
      type: CombatEffectType.SPELL_CHARGE,
      id: spell.selfCharge.id || `${spell.id || 'spell'}:charge`,
      ...spell.selfCharge
    });
  }
  if (num(spell.minCastInterval || spell.cooldown, 0) > 0 || num(spell.initialCooldown, 0) > 0) {
    effects.push({
      type: CombatEffectType.COOLDOWN,
      id: `${spell.id || 'spell'}:cooldown`,
      intervalTurns: Math.max(0, num(spell.minCastInterval || spell.cooldown, 0)),
      initialTurns: Math.max(0, num(spell.initialCooldown, 0))
    });
  }
  effects.push({
    type: CombatEffectType.CAST_LIMIT,
    id: `${spell.id || 'spell'}:cast-limit`,
    perTurn: positiveInt(spell.maxCastPerTurn || 99, 99),
    perTarget: positiveInt(spell.maxCastPerTarget || spell.maxCastPerTurn || 99, 99)
  });
  for (const effect of spell.effects || []) effects.push(normalizeCombatEffect(effect));
  return effects;
}

export function combatEffectsOfType(spellOrEffects, type) {
  const effects = Array.isArray(spellOrEffects) ? spellOrEffects : spellCombatEffects(spellOrEffects);
  return effects.filter((effect) => effect.type === type);
}

export function firstCombatEffect(spellOrEffects, type) {
  return combatEffectsOfType(spellOrEffects, type)[0] || null;
}

function retainedCombatStates(states = {}, turn = 1) {
  const current = Math.max(1, num(turn, 1));
  return Object.fromEntries(Object.entries(states || {}).filter(([, entry]) => num(entry?.expiresAfterTurn, 0) >= current));
}

export function expireCombatStates(states = {}, turn = 1) {
  return Object.fromEntries(Object.entries(retainedCombatStates(states, turn)).map(([key, entry]) => [key, {
    ...entry,
    value: entry?.value && typeof entry.value === 'object' ? structuredClone(entry.value) : entry?.value
  }]));
}

export function combatStateValue(states = {}, key, turn = 1) {
  const entry = retainedCombatStates(states, turn)[String(key)];
  if (!entry || num(entry.appliedTurn, 1) > num(turn, 1)) return null;
  return entry.value;
}

function stableValue(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`;
  return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => `${JSON.stringify(key)}:${stableValue(entry)}`).join(',')}}`;
}

export function combatStateSignature(states = {}, turn = 1) {
  return Object.entries(retainedCombatStates(states, turn))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, entry]) => `${key}:${entry.appliedTurn}:${entry.expiresAfterTurn}:${stableValue(entry.value)}`)
    .join('|');
}

function pathValue(root, path = '') {
  return String(path).split('.').filter(Boolean).reduce((value, key) => value?.[key], root);
}

export function combatConditionMatches(condition = {}, { state = {}, turn = 1, context = {} } = {}) {
  if (!condition || typeof condition !== 'object' || !Object.keys(condition).length) return true;
  if (Array.isArray(condition.all)) return condition.all.every((entry) => combatConditionMatches(entry, { state, turn, context }));
  if (Array.isArray(condition.any)) return condition.any.some((entry) => combatConditionMatches(entry, { state, turn, context }));
  if (condition.not) return !combatConditionMatches(condition.not, { state, turn, context });

  if (condition.stateKey) {
    const value = combatStateValue(state.combatStates, condition.stateKey, turn);
    if (Object.prototype.hasOwnProperty.call(condition, 'equals')) return stableValue(value) === stableValue(condition.equals);
    if (Array.isArray(condition.in)) return condition.in.some((candidate) => stableValue(candidate) === stableValue(value));
    return Boolean(value);
  }

  if (condition.contextPath) {
    const value = pathValue(context, condition.contextPath);
    if (Object.prototype.hasOwnProperty.call(condition, 'equals')) return stableValue(value) === stableValue(condition.equals);
    if (Array.isArray(condition.in)) return condition.in.some((candidate) => stableValue(candidate) === stableValue(value));
    return Boolean(value);
  }
  return false;
}

function effectAsModifier(effect, delayTurns = 0) {
  return {
    id: effect.id,
    scope: effect.type === CombatEffectType.TARGET_MODIFIER ? 'target' : 'self',
    stats: { ...(effect.stats || {}) },
    durationTurns: positiveInt(effect.durationTurns || 1),
    delayTurns: Math.max(0, num(delayTurns, 0)),
    stacking: effect.stacking || 'replace-source'
  };
}

function applyStateEffect(state, effect, sourceId, turn, delayTurns = 0) {
  const key = String(effect.key || effect.id || 'state');
  const appliedTurn = Math.max(1, num(turn, 1)) + Math.max(0, num(delayTurns, 0));
  const durationTurns = positiveInt(effect.durationTurns || 1);
  return {
    ...state,
    combatStates: {
      ...retainedCombatStates(state.combatStates, turn),
      [key]: {
        id: String(effect.id || key),
        key,
        sourceId: String(sourceId || 'unknown'),
        value: effect.value && typeof effect.value === 'object' ? structuredClone(effect.value) : effect.value,
        appliedTurn,
        expiresAfterTurn: appliedTurn + durationTurns - 1
      }
    }
  };
}

function consumeStateEffect(state, effect, turn) {
  const key = String(effect.key || effect.id || 'state');
  const combatStates = retainedCombatStates(state.combatStates, turn);
  delete combatStates[key];
  return { ...state, combatStates };
}

function applyOne(state, effect, { sourceId, turn, context, inheritedDelay = 0 }) {
  const normalized = normalizeCombatEffect(effect);
  if (normalized.type === CombatEffectType.CONDITIONAL) {
    if (!combatConditionMatches(normalized.condition || {}, { state, turn, context })) return state;
    return (normalized.effects || []).reduce((next, nested) => applyOne(next, nested, { sourceId, turn, context, inheritedDelay }), state);
  }
  if (normalized.type === CombatEffectType.DELAYED_EFFECT) {
    return applyOne(state, normalized.effect, {
      sourceId,
      turn,
      context,
      inheritedDelay: inheritedDelay + Math.max(0, num(normalized.delayTurns, 0))
    });
  }
  if (normalized.type === CombatEffectType.STAT_MODIFIER || normalized.type === CombatEffectType.TARGET_MODIFIER) {
    return {
      ...state,
      modifiers: applyTimedModifiers(state.modifiers, [effectAsModifier(normalized, inheritedDelay)], sourceId, turn)
    };
  }
  if (normalized.type === CombatEffectType.STATE) return applyStateEffect(state, normalized, sourceId, turn, inheritedDelay);
  if (normalized.type === CombatEffectType.CONSUME_STATE) return consumeStateEffect(state, normalized, turn);
  return state;
}

export function applyCombatEffects(state = {}, effects = [], { sourceId = 'unknown', turn = 1, context = {} } = {}) {
  return (effects || []).reduce((next, effect) => applyOne(next, effect, { sourceId, turn, context, inheritedDelay: 0 }), state);
}

export function activeSpellCharges(charges = {}, turn = 1) {
  const result = {};
  for (const [spellId, charge] of Object.entries(charges || {})) {
    if (num(charge?.appliedTurn, 1) > turn) continue;
    if (num(charge?.expiresAfterTurn, 0) < turn) continue;
    result[spellId] = { ...charge };
  }
  return result;
}

export function spellChargeSignature(charges = {}, turn = 1) {
  return Object.entries(activeSpellCharges(charges, turn))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, charge]) => `${id}:${num(charge.bonus).toFixed(3)}:${charge.expiresAfterTurn}`)
    .join('|');
}

function addChargeToRange(range, amount) {
  if (!Array.isArray(range)) return range;
  return range.map((value) => Number(value || 0) + amount);
}

export function spellWithActiveCombatCharge(spell = {}, charges = {}, turn = 1) {
  const charge = activeSpellCharges(charges, turn)[String(spell.id)];
  if (!charge || !(spell.hits || []).length) return spell;
  const bonus = Number(charge.bonus || 0);
  return {
    ...spell,
    hits: spell.hits.map((hit, index) => index === 0 ? {
      ...hit,
      normal: addChargeToRange(hit.normal, bonus),
      crit: addChargeToRange(hit.crit ?? hit.normal, bonus)
    } : hit)
  };
}
