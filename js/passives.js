import { addStats, cloneStats } from './stats.js';

function contextValue(context, key) {
  if (!key) return undefined;
  return String(key).split('.').reduce((value, part) => value?.[part], context);
}

function hasContextValue(context, key) {
  return contextValue(context, key) !== undefined;
}

function compare(actual, operator, expected) {
  if (operator === 'eq') return actual === expected;
  if (operator === 'neq') return actual !== expected;
  if (operator === 'gt') return actual > expected;
  if (operator === 'gte') return actual >= expected;
  if (operator === 'lt') return actual < expected;
  if (operator === 'lte') return actual <= expected;
  return false;
}

export function passiveTriggerState(trigger = {}, context = {}) {
  const turn = Number(context.turn || 1);
  const type = trigger.type || 'always';
  if (type === 'always') return { matches: true, resolved: true, missingKeys: [] };
  if (type === 'turn_parity') {
    const matches = trigger.parity === 'odd' ? turn % 2 === 1 : trigger.parity === 'even' ? turn % 2 === 0 : false;
    return { matches, resolved: true, missingKeys: [] };
  }
  if (type === 'turn_in') {
    return { matches: Array.isArray(trigger.turns) && trigger.turns.includes(turn), resolved: true, missingKeys: [] };
  }
  if (type === 'turn_cycle') {
    const length = Math.max(1, Number(trigger.length || 1));
    const position = Math.max(1, Number(trigger.position || 1));
    const normalized = ((turn - 1) % length) + 1;
    return { matches: normalized === position, resolved: true, missingKeys: [] };
  }
  if (type === 'context_equals') {
    if (!hasContextValue(context, trigger.key)) return { matches: false, resolved: false, missingKeys: [trigger.key] };
    return { matches: contextValue(context, trigger.key) === trigger.value, resolved: true, missingKeys: [] };
  }
  if (type === 'context_compare') {
    if (!hasContextValue(context, trigger.key)) return { matches: false, resolved: false, missingKeys: [trigger.key] };
    const actual = Number(contextValue(context, trigger.key));
    const expected = Number(trigger.value);
    if (!Number.isFinite(actual) || !Number.isFinite(expected)) return { matches: false, resolved: false, missingKeys: [trigger.key] };
    return { matches: compare(actual, trigger.operator || 'eq', expected), resolved: true, missingKeys: [] };
  }
  if (type === 'all' || type === 'any') {
    const states = (trigger.triggers || []).map((child) => passiveTriggerState(child, context));
    const missingKeys = [...new Set(states.flatMap((state) => state.missingKeys || []))];
    if (type === 'all') {
      if (states.some((state) => state.resolved && !state.matches)) return { matches: false, resolved: true, missingKeys: [] };
      if (states.some((state) => !state.resolved)) return { matches: false, resolved: false, missingKeys };
      return { matches: true, resolved: true, missingKeys: [] };
    }
    if (states.some((state) => state.resolved && state.matches)) return { matches: true, resolved: true, missingKeys: [] };
    if (states.some((state) => !state.resolved)) return { matches: false, resolved: false, missingKeys };
    return { matches: false, resolved: true, missingKeys: [] };
  }
  if (type === 'not') {
    const state = passiveTriggerState(trigger.trigger || {}, context);
    return state.resolved ? { matches: !state.matches, resolved: true, missingKeys: [] } : state;
  }
  return { matches: false, resolved: false, missingKeys: [] };
}

export function passiveTriggerMatches(trigger = {}, context = {}) {
  const state = passiveTriggerState(trigger, context);
  return state.resolved && state.matches;
}

function resolveRuleStats(rule, context) {
  const stats = { ...(rule.stats || {}) };
  const missingKeys = [];
  for (const scaled of rule.scaledStats || []) {
    if (!hasContextValue(context, scaled.contextKey)) {
      missingKeys.push(scaled.contextKey);
      continue;
    }
    let value = Number(contextValue(context, scaled.contextKey));
    if (!Number.isFinite(value)) {
      missingKeys.push(scaled.contextKey);
      continue;
    }
    if (Number.isFinite(scaled.min)) value = Math.max(value, scaled.min);
    if (Number.isFinite(scaled.max)) value = Math.min(value, scaled.max);
    const amount = value * Number(scaled.multiplier ?? 1) + Number(scaled.offset ?? 0);
    if (Number.isFinite(amount)) stats[scaled.stat] = (stats[scaled.stat] || 0) + amount;
  }
  return { stats, missingKeys: [...new Set(missingKeys)] };
}

export function applyPassiveModifiers(baseStats = {}, passives = [], context = {}) {
  const stats = cloneStats(baseStats);
  const applied = [];
  const unresolved = [];
  for (const passive of passives || []) {
    for (const rule of passive.rules || []) {
      const trigger = passiveTriggerState(rule.trigger, context);
      if (!trigger.resolved) {
        unresolved.push({ passiveId: passive.id, ruleId: rule.id || null, missingKeys: trigger.missingKeys || [] });
        continue;
      }
      if (!trigger.matches) continue;
      const resolved = resolveRuleStats(rule, context);
      if (resolved.missingKeys.length) {
        unresolved.push({ passiveId: passive.id, ruleId: rule.id || null, missingKeys: resolved.missingKeys });
        continue;
      }
      addStats(stats, resolved.stats);
      applied.push({ passiveId: passive.id, ruleId: rule.id || null, stats: { ...resolved.stats } });
    }
  }
  return { stats, applied, unresolved };
}

export function itemPassivesForTurn(items = [], turn = 1, context = {}) {
  const passives = [];
  for (const item of items || []) passives.push(...(item.passives || []));
  return applyPassiveModifiers({}, passives, { ...context, turn });
}
