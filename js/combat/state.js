import { applyTimedModifiers } from '../combat-state.js';
import {
  SpellEffectSemanticStatus,
  SpellEffectSemanticType,
  assertCertifiedSpellSemantics,
  normalizeSpellEffectSemantics,
  resolveSpellEffectSemantic
} from './spell-effect-semantic.js';

function num(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function positiveInt(value, fallback = 1) {
  return Math.max(1, Math.floor(num(value, fallback)));
}

function nonNegativeInt(value, fallback = 0) {
  return Math.max(0, Math.floor(num(value, fallback)));
}

function cloneValue(value) {
  if (value === undefined || value === null || typeof value !== 'object') return value;
  return structuredClone(value);
}

function cloneRecord(value = {}) {
  return cloneValue(value || {}) || {};
}

function retainedTimedEntries(entries = [], turn = 1) {
  return (entries || [])
    .filter((entry) => num(entry?.expiresAfterTurn, 0) >= turn)
    .map((entry) => cloneValue(entry));
}

function activeTimedEntries(entries = [], turn = 1) {
  return retainedTimedEntries(entries, turn)
    .filter((entry) => num(entry?.appliedTurn, 1) <= turn);
}

function retainedTimedRecord(record = {}, turn = 1) {
  return Object.fromEntries(Object.entries(record || {})
    .filter(([, entry]) => num(entry?.expiresAfterTurn, 0) >= turn)
    .map(([key, entry]) => [key, cloneValue(entry)]));
}

function sumTimedStat(entries = [], stat, turn = 1) {
  return activeTimedEntries(entries, turn)
    .reduce((sum, entry) => sum + num(entry?.stats?.[stat], 0), 0);
}

function targetCastKey(spellId, targetId = 'default') {
  return `${String(targetId)}:${String(spellId)}`;
}

function resolvedResourceBase(input, camel, upper, fallback = 0) {
  return Math.max(0, num(input[camel] ?? input[upper] ?? fallback, fallback));
}

function pruneReadyCooldowns(cooldowns = {}, turn = 1) {
  return Object.fromEntries(Object.entries(cooldowns || {})
    .filter(([, readyTurn]) => num(readyTurn, 0) > turn)
    .map(([key, readyTurn]) => [key, num(readyTurn, 0)]));
}

function initialCooldownRecord(initialCooldowns = {}, turn = 1) {
  return Object.fromEntries(Object.entries(initialCooldowns || {})
    .filter(([, turns]) => nonNegativeInt(turns, 0) > 0)
    .map(([spellId, turns]) => [String(spellId), turn + nonNegativeInt(turns, 0)]));
}

export function createCombatState(input = {}) {
  const turn = positiveInt(input.turn, 1);
  const baseAp = resolvedResourceBase(input, 'baseAp', 'baseAP', input.ap ?? 0);
  const baseMp = resolvedResourceBase(input, 'baseMp', 'baseMP', input.mp ?? 0);
  const initialCooldowns = initialCooldownRecord(input.initialCooldowns, turn);
  const cooldowns = { ...initialCooldowns, ...cloneRecord(input.cooldowns) };

  return {
    turn,
    phase: input.phase === 'ended' ? 'ended' : 'active',
    baseAp,
    currentAp: Math.max(0, num(input.currentAp ?? input.currentAP, baseAp)),
    baseMp,
    currentMp: Math.max(0, num(input.currentMp ?? input.currentMP, baseMp)),
    activeBuffs: (input.activeBuffs || []).map((entry) => cloneValue(entry)),
    activeTargetDebuffs: (input.activeTargetDebuffs || input.activeDebuffsTarget || []).map((entry) => cloneValue(entry)),
    cooldowns,
    castsThisTurn: cloneRecord(input.castsThisTurn),
    castsPerTarget: cloneRecord(input.castsPerTarget),
    states: cloneRecord(input.states),
    charges: cloneRecord(input.charges),
    pendingEffects: (input.pendingEffects || []).map((entry) => cloneValue(entry)),
    spellLocalState: cloneRecord(input.spellLocalState),
    nextCastModifiers: cloneRecord(input.nextCastModifiers)
  };
}

export function cloneCombatState(state = {}) {
  return createCombatState(cloneValue(state));
}

export function combatStateCanSpendAp(state = {}, amount = 0) {
  return num(state.currentAp, 0) + 1e-9 >= Math.max(0, num(amount, 0));
}

export function spendCombatAp(state = {}, amount = 0) {
  const cost = Math.max(0, num(amount, 0));
  if (!combatStateCanSpendAp(state, cost)) {
    throw new RangeError(`Not enough AP: need ${cost}, have ${num(state.currentAp, 0)}`);
  }
  const next = cloneCombatState(state);
  next.currentAp = Math.max(0, num(next.currentAp, 0) - cost);
  return next;
}

export function combatCastEligibility(state = {}, {
  spellId,
  apCost = 0,
  targetId = 'default',
  castLimit = {}
} = {}) {
  const id = String(spellId || '');
  if (!id) return { eligible: false, reason: 'SPELL_ID_REQUIRED' };
  if (!combatStateCanSpendAp(state, apCost)) return { eligible: false, reason: 'INSUFFICIENT_AP' };

  const readyTurn = num(state.cooldowns?.[id], state.turn);
  if (readyTurn > state.turn) return { eligible: false, reason: 'COOLDOWN' };

  const perTurn = positiveInt(castLimit.perTurn ?? castLimit.maxCastPerTurn ?? 999999, 999999);
  const perTarget = positiveInt(castLimit.perTarget ?? castLimit.maxCastPerTarget ?? perTurn, perTurn);
  if (num(state.castsThisTurn?.[id], 0) >= perTurn) return { eligible: false, reason: 'CAST_LIMIT_TURN' };
  const targetKey = targetCastKey(id, targetId);
  if (num(state.castsPerTarget?.[targetKey], 0) >= perTarget) return { eligible: false, reason: 'CAST_LIMIT_TARGET' };
  return { eligible: true, reason: null };
}

export function setCombatCooldown(state = {}, spellId, intervalTurns = 0) {
  const id = String(spellId || '');
  if (!id) throw new Error('Cooldown requires a spell id.');
  const interval = nonNegativeInt(intervalTurns, 0);
  const next = cloneCombatState(state);
  if (interval <= 0) {
    delete next.cooldowns[id];
    return next;
  }
  next.cooldowns[id] = next.turn + interval;
  return next;
}

export function recordCombatCast(state = {}, {
  spellId,
  targetId = 'default',
  cooldownTurns = 0
} = {}) {
  const id = String(spellId || '');
  if (!id) throw new Error('Combat cast requires a spell id.');
  let next = cloneCombatState(state);
  next.castsThisTurn[id] = num(next.castsThisTurn[id], 0) + 1;
  const targetKey = targetCastKey(id, targetId);
  next.castsPerTarget[targetKey] = num(next.castsPerTarget[targetKey], 0) + 1;
  if (nonNegativeInt(cooldownTurns, 0) > 0) next = setCombatCooldown(next, id, cooldownTurns);
  return next;
}

function addTimedStatModifier(state, effect, sourceId) {
  const scope = effect.target === 'target' || effect.scope === 'target' ? 'target' : 'self';
  const collectionKey = scope === 'target' ? 'activeTargetDebuffs' : 'activeBuffs';
  const raw = {
    id: effect.id,
    scope,
    stats: cloneRecord(effect.stats),
    durationTurns: positiveInt(effect.durationTurns ?? effect.duration, 1),
    stacking: effect.stacking || 'replace-source'
  };
  const next = cloneCombatState(state);
  const beforeAp = scope === 'self' ? sumTimedStat(next[collectionKey], 'ap', next.turn) : 0;
  const beforeMp = scope === 'self' ? sumTimedStat(next[collectionKey], 'mp', next.turn) : 0;
  next[collectionKey] = applyTimedModifiers(next[collectionKey], [raw], sourceId, next.turn);
  if (scope === 'self') {
    const afterAp = sumTimedStat(next[collectionKey], 'ap', next.turn);
    const afterMp = sumTimedStat(next[collectionKey], 'mp', next.turn);
    next.currentAp = Math.max(0, next.currentAp + afterAp - beforeAp);
    next.currentMp = Math.max(0, next.currentMp + afterMp - beforeMp);
  }
  return next;
}

export function applyCombatStateValue(state = {}, {
  id,
  key,
  value = true,
  durationTurns = 1,
  sourceId = 'unknown'
} = {}) {
  const stateKey = String(key || id || '');
  if (!stateKey) throw new Error('State semantic requires a key or id.');
  const next = cloneCombatState(state);
  next.states[stateKey] = {
    id: String(id || stateKey),
    key: stateKey,
    sourceId: String(sourceId),
    value: cloneValue(value),
    appliedTurn: next.turn,
    expiresAfterTurn: next.turn + positiveInt(durationTurns, 1) - 1
  };
  return next;
}

export function consumeCombatStateValue(state = {}, key) {
  const next = cloneCombatState(state);
  delete next.states[String(key || '')];
  return next;
}

export function combatStateValue(state = {}, key) {
  const entry = state.states?.[String(key || '')];
  if (!entry) return null;
  if (num(entry.appliedTurn, 1) > state.turn || num(entry.expiresAfterTurn, 0) < state.turn) return null;
  return cloneValue(entry.value);
}

export function addCombatCharge(state = {}, charge = {}, { sourceId = 'unknown' } = {}) {
  const key = String(charge.key || charge.id || charge.targetSpellId || sourceId || 'charge');
  const next = cloneCombatState(state);
  const active = retainedTimedRecord(next.charges, next.turn);
  const previous = active[key];
  const maxStacks = positiveInt(charge.maxStacks ?? previous?.maxStacks ?? 1, 1);
  const addedStacks = positiveInt(charge.stacks ?? 1, 1);
  const stacks = Math.min(maxStacks, nonNegativeInt(previous?.stacks, 0) + addedStacks);
  active[key] = {
    ...cloneValue(previous || {}),
    ...cloneValue(charge),
    id: String(charge.id || key),
    key,
    sourceId: String(sourceId),
    stacks,
    maxStacks,
    appliedTurn: next.turn,
    expiresAfterTurn: next.turn + positiveInt(charge.durationTurns ?? 1, 1) - 1
  };
  next.charges = active;
  return next;
}

export function consumeCombatCharge(state = {}, key, stacks = 1) {
  const chargeKey = String(key || '');
  const next = cloneCombatState(state);
  const charge = next.charges[chargeKey];
  if (!charge) return next;
  const remaining = Math.max(0, nonNegativeInt(charge.stacks, 0) - positiveInt(stacks, 1));
  if (remaining === 0) delete next.charges[chargeKey];
  else next.charges[chargeKey] = { ...charge, stacks: remaining };
  return next;
}

export function addNextCastModifier(state = {}, modifier = {}, { sourceId = 'unknown' } = {}) {
  const id = String(modifier.id || `${sourceId}:next-cast`);
  const next = cloneCombatState(state);
  const active = retainedTimedRecord(next.nextCastModifiers, next.turn);
  const previous = active[id];
  const maxStacks = positiveInt(modifier.maxStacks ?? previous?.maxStacks ?? 1, 1);
  const addedStacks = positiveInt(modifier.stacks ?? 1, 1);
  active[id] = {
    ...cloneValue(previous || {}),
    ...cloneValue(modifier),
    id,
    sourceId: String(sourceId),
    targetSpellId: String(modifier.targetSpellId || modifier.spellId || '*'),
    stacks: Math.min(maxStacks, nonNegativeInt(previous?.stacks, 0) + addedStacks),
    maxStacks,
    consumeStacks: positiveInt(modifier.consumeStacks ?? 1, 1),
    payload: cloneValue(modifier.payload ?? modifier.value ?? {}),
    normalPayload: cloneValue(modifier.normalPayload ?? modifier.payload ?? modifier.value ?? {}),
    criticalPayload: cloneValue(modifier.criticalPayload ?? modifier.normalPayload ?? modifier.payload ?? modifier.value ?? {}),
    appliedTurn: next.turn,
    expiresAfterTurn: next.turn + positiveInt(modifier.durationTurns ?? 1, 1) - 1
  };
  next.nextCastModifiers = active;
  return next;
}

export function consumeNextCastModifiers(state = {}, {
  spellId,
  critical = false
} = {}) {
  const id = String(spellId || '');
  const next = cloneCombatState(state);
  const active = retainedTimedRecord(next.nextCastModifiers, next.turn);
  const applied = [];

  for (const [modifierId, modifier] of Object.entries(active)) {
    if (modifier.targetSpellId !== '*' && modifier.targetSpellId !== id) continue;
    applied.push({
      id: modifierId,
      sourceId: modifier.sourceId,
      payload: cloneValue(critical ? modifier.criticalPayload : modifier.normalPayload)
    });
    const remaining = Math.max(0, nonNegativeInt(modifier.stacks, 0) - positiveInt(modifier.consumeStacks, 1));
    if (remaining === 0) delete active[modifierId];
    else active[modifierId] = { ...modifier, stacks: remaining };
  }

  next.nextCastModifiers = active;
  return { state: next, applied };
}

export function scheduleCombatEffect(state = {}, {
  effect = null,
  effects = null,
  delayTurns = 1,
  sourceId = 'unknown',
  critical = false,
  targetId = 'default'
} = {}) {
  const list = effects || (effect ? [effect] : []);
  const next = cloneCombatState(state);
  next.pendingEffects.push({
    id: `${String(sourceId)}:pending:${next.pendingEffects.length}`,
    sourceId: String(sourceId),
    dueTurn: next.turn + nonNegativeInt(delayTurns, 0),
    effects: cloneValue(list),
    critical: Boolean(critical),
    targetId: String(targetId)
  });
  return next;
}

function combatStateConditionMatches(condition = {}, state = {}) {
  if (!condition || typeof condition !== 'object' || !Object.keys(condition).length) return true;
  if (Array.isArray(condition.all)) return condition.all.every((entry) => combatStateConditionMatches(entry, state));
  if (Array.isArray(condition.any)) return condition.any.some((entry) => combatStateConditionMatches(entry, state));
  if (condition.not) return !combatStateConditionMatches(condition.not, state);

  if (condition.stateKey) {
    const value = combatStateValue(state, condition.stateKey);
    if (Object.prototype.hasOwnProperty.call(condition, 'equals')) {
      return JSON.stringify(value) === JSON.stringify(condition.equals);
    }
    return value !== null;
  }
  if (condition.chargeKey) {
    const charge = state.charges?.[String(condition.chargeKey)];
    const stacks = num(charge?.stacks, 0);
    if (condition.minStacks !== undefined) return stacks >= num(condition.minStacks, 0);
    return stacks > 0;
  }
  throw new Error('CombatState condition is not supported by this core.');
}

function semanticEffects(effect) {
  if (Array.isArray(effect.effects)) return effect.effects;
  if (effect.effect) return [effect.effect];
  return [];
}

export function applySpellEffectSemantic(state = {}, effect = {}, {
  sourceId = 'unknown',
  critical = false,
  targetId = 'default'
} = {}) {
  assertCertifiedSpellSemantics([effect]);
  const resolved = resolveSpellEffectSemantic(effect, { critical });

  switch (resolved.type) {
    case SpellEffectSemanticType.DAMAGE:
    case SpellEffectSemanticType.CAST_LIMIT:
      return cloneCombatState(state);

    case SpellEffectSemanticType.STAT_MODIFIER:
      return addTimedStatModifier(state, resolved, sourceId);

    case SpellEffectSemanticType.STATE:
      if (resolved.operation === 'consume') return consumeCombatStateValue(state, resolved.key || resolved.id);
      return applyCombatStateValue(state, { ...resolved, sourceId });

    case SpellEffectSemanticType.CHARGE:
      return addCombatCharge(state, resolved, { sourceId });

    case SpellEffectSemanticType.NEXT_CAST_MODIFIER:
      return addNextCastModifier(state, resolved, { sourceId });

    case SpellEffectSemanticType.DELAYED_EFFECT: {
      const nested = semanticEffects(resolved);
      const delayTurns = nonNegativeInt(resolved.delayTurns, 0);
      if (delayTurns === 0) return applySpellEffectSemantics(state, nested, { sourceId, critical, targetId });
      return scheduleCombatEffect(state, { effects: nested, delayTurns, sourceId, critical, targetId });
    }

    case SpellEffectSemanticType.COOLDOWN:
      return setCombatCooldown(state, resolved.spellId || sourceId, resolved.intervalTurns ?? resolved.turns ?? 0);

    case SpellEffectSemanticType.CONDITION:
      if (!combatStateConditionMatches(resolved.condition || {}, state)) return cloneCombatState(state);
      return applySpellEffectSemantics(state, semanticEffects(resolved), { sourceId, critical, targetId });

    case SpellEffectSemanticType.TRIGGER:
    case SpellEffectSemanticType.TARGET:
    case SpellEffectSemanticType.MOVEMENT:
      throw new Error(`CombatState transition is not implemented for semantic type: ${resolved.type}`);

    default:
      throw new Error(`Unknown CombatState semantic type: ${resolved.type}`);
  }
}

export function applySpellEffectSemantics(state = {}, effects = [], context = {}) {
  const normalized = assertCertifiedSpellSemantics(effects);
  return normalized.reduce((next, effect) => applySpellEffectSemantic(next, effect, context), cloneCombatState(state));
}

export function startCombatTurn(state = {}, turn = null) {
  const nextTurn = positiveInt(turn ?? state.turn, state.turn || 1);
  let next = cloneCombatState({ ...state, turn: nextTurn, phase: 'active' });
  next.activeBuffs = retainedTimedEntries(next.activeBuffs, nextTurn);
  next.activeTargetDebuffs = retainedTimedEntries(next.activeTargetDebuffs, nextTurn);
  next.states = retainedTimedRecord(next.states, nextTurn);
  next.charges = retainedTimedRecord(next.charges, nextTurn);
  next.nextCastModifiers = retainedTimedRecord(next.nextCastModifiers, nextTurn);
  next.cooldowns = pruneReadyCooldowns(next.cooldowns, nextTurn);
  next.castsThisTurn = {};
  next.castsPerTarget = {};
  next.currentAp = Math.max(0, next.baseAp + sumTimedStat(next.activeBuffs, 'ap', nextTurn));
  next.currentMp = Math.max(0, next.baseMp + sumTimedStat(next.activeBuffs, 'mp', nextTurn));

  const due = next.pendingEffects.filter((entry) => num(entry.dueTurn, Infinity) <= nextTurn);
  next.pendingEffects = next.pendingEffects.filter((entry) => num(entry.dueTurn, Infinity) > nextTurn);
  for (const pending of due) {
    next = applySpellEffectSemantics(next, pending.effects, {
      sourceId: pending.sourceId,
      critical: pending.critical,
      targetId: pending.targetId
    });
  }
  return next;
}

export function endCombatTurn(state = {}) {
  return cloneCombatState({ ...state, phase: 'ended' });
}

export function advanceCombatTurn(state = {}) {
  const ended = endCombatTurn(state);
  return startCombatTurn(ended, positiveInt(ended.turn, 1) + 1);
}

function firstSemanticOfType(effects, type) {
  return effects.find((effect) => effect.type === type) || null;
}

export function applyCombatAction(state = {}, action = {}) {
  const effects = normalizeSpellEffectSemantics(action.effects || []);
  assertCertifiedSpellSemantics(effects);
  const castLimit = action.castLimit || firstSemanticOfType(effects, SpellEffectSemanticType.CAST_LIMIT) || {};
  const eligibility = combatCastEligibility(state, {
    spellId: action.spellId,
    apCost: action.apCost,
    targetId: action.targetId,
    castLimit
  });
  if (!eligibility.eligible) {
    const error = new Error(`Combat action is not eligible: ${eligibility.reason}`);
    error.reason = eligibility.reason;
    throw error;
  }

  let next = spendCombatAp(state, action.apCost || 0);
  const consumed = consumeNextCastModifiers(next, {
    spellId: action.spellId,
    critical: Boolean(action.critical)
  });
  next = consumed.state;
  next = recordCombatCast(next, {
    spellId: action.spellId,
    targetId: action.targetId
  });
  next = applySpellEffectSemantics(next, effects, {
    sourceId: String(action.spellId),
    critical: Boolean(action.critical),
    targetId: action.targetId
  });
  next.spellLocalState.lastAction = {
    spellId: String(action.spellId),
    targetId: String(action.targetId || 'default'),
    critical: Boolean(action.critical),
    appliedNextCastModifiers: cloneValue(consumed.applied)
  };
  return { state: next, appliedNextCastModifiers: consumed.applied };
}

export function transitionCombatState(state = {}, action = {}) {
  return applyCombatAction(state, action).state;
}

export function combatStateSemanticSupport() {
  return Object.freeze({
    [SpellEffectSemanticType.DAMAGE]: SpellEffectSemanticStatus.SUPPORTED,
    [SpellEffectSemanticType.STAT_MODIFIER]: SpellEffectSemanticStatus.SUPPORTED,
    [SpellEffectSemanticType.STATE]: SpellEffectSemanticStatus.SUPPORTED,
    [SpellEffectSemanticType.CHARGE]: SpellEffectSemanticStatus.SUPPORTED,
    [SpellEffectSemanticType.NEXT_CAST_MODIFIER]: SpellEffectSemanticStatus.SUPPORTED,
    [SpellEffectSemanticType.DELAYED_EFFECT]: SpellEffectSemanticStatus.SUPPORTED,
    [SpellEffectSemanticType.COOLDOWN]: SpellEffectSemanticStatus.SUPPORTED,
    [SpellEffectSemanticType.CAST_LIMIT]: SpellEffectSemanticStatus.SUPPORTED,
    [SpellEffectSemanticType.CONDITION]: SpellEffectSemanticStatus.SUPPORTED,
    [SpellEffectSemanticType.TARGET]: SpellEffectSemanticStatus.UNRESOLVED,
    [SpellEffectSemanticType.TRIGGER]: SpellEffectSemanticStatus.UNRESOLVED,
    [SpellEffectSemanticType.MOVEMENT]: SpellEffectSemanticStatus.UNRESOLVED
  });
}
