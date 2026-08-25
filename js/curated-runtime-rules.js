import { defaultCombatMechanicsRegistry } from './combat/mechanics/default-registry.js';

const GANYMEDE_ANKAMA_ID = 20360;

export const GANYMEDE_PASSIVE = Object.freeze({
  id: 'ganymede-wisdom',
  label: 'Sagesse de Ganymède',
  source: 'curated-item-rule',
  rules: [
    {
      id: 'odd-turn',
      trigger: { type: 'turn_parity', parity: 'odd' },
      stats: { ap: -1, mp: -1 }
    },
    {
      id: 'even-turn',
      trigger: { type: 'turn_parity', parity: 'even' },
      stats: { ap: 2 }
    }
  ]
});

function clonePassive(passive) {
  return {
    ...passive,
    rules: (passive.rules || []).map((rule) => ({
      ...rule,
      trigger: rule.trigger ? structuredClone(rule.trigger) : undefined,
      stats: { ...(rule.stats || {}) },
      scaledStats: (rule.scaledStats || []).map((entry) => ({ ...entry }))
    }))
  };
}

export function applyCuratedItemRules(item = {}) {
  if (Number(item?.ankamaId) !== GANYMEDE_ANKAMA_ID) return item;
  const passives = Array.isArray(item.passives) ? item.passives : [];
  if (passives.some((passive) => passive?.id === GANYMEDE_PASSIVE.id)) return item;
  return {
    ...item,
    passives: [...passives, clonePassive(GANYMEDE_PASSIVE)]
  };
}

export function applyCuratedSpellRules(spell = {}) {
  return defaultCombatMechanicsRegistry.prepareSpell(spell);
}
