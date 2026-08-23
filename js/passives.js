import { addStats, cloneStats } from './stats.js';

export function passiveTriggerMatches(trigger = {}, context = {}) {
  const turn = Number(context.turn || 1);
  const type = trigger.type || 'always';
  if (type === 'always') return true;
  if (type === 'turn_parity') {
    if (trigger.parity === 'odd') return turn % 2 === 1;
    if (trigger.parity === 'even') return turn % 2 === 0;
    return false;
  }
  if (type === 'turn_in') return Array.isArray(trigger.turns) && trigger.turns.includes(turn);
  return false;
}

export function applyPassiveModifiers(baseStats = {}, passives = [], context = {}) {
  const stats = cloneStats(baseStats);
  const applied = [];
  for (const passive of passives || []) {
    for (const rule of passive.rules || []) {
      if (!passiveTriggerMatches(rule.trigger, context)) continue;
      addStats(stats, rule.stats || {});
      applied.push({ passiveId: passive.id, ruleId: rule.id || null, stats: { ...(rule.stats || {}) } });
    }
  }
  return { stats, applied };
}

export function itemPassivesForTurn(items = [], turn = 1) {
  const passives = [];
  for (const item of items || []) passives.push(...(item.passives || []));
  return applyPassiveModifiers({}, passives, { turn });
}
