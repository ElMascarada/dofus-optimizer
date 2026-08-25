const CONCENTRATION_ANKAMA_ID = 13123;
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
  if (Number(spell?.ankamaId) !== CONCENTRATION_ANKAMA_ID) return spell;
  const hits = Array.isArray(spell.hits) ? spell.hits : [];
  if (hits.length <= 1) return spell;

  // Concentration's second Earth line only damages summons. The optimizer's
  // default target is a normal enemy, so only the first line belongs in the
  // generic damage rotation. A summon-target context can reintroduce it later.
  return {
    ...spell,
    hits: hits.slice(0, 1).map((hit) => ({
      ...hit,
      normal: [...(hit.normal || [])],
      crit: [...(hit.crit || [])]
    })),
    curatedDamageRule: 'exclude-summon-only-secondary-hit'
  };
}
