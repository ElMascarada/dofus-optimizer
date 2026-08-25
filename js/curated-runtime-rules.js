const CONCENTRATION_ANKAMA_ID = 13123;
const PRECIPITATION_ANKAMA_ID = 13114;
const ACCUMULATION_ANKAMA_ID = 13138;
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

function cloneModifier(modifier) {
  return { ...modifier, stats: { ...(modifier.stats || {}) } };
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

function concentrationRule(spell) {
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

function precipitationRule(spell) {
  const delayed = (spell.delayedCombatModifiers || []).map(cloneModifier);
  if (!delayed.some((modifier) => modifier.id === 'iop-precipitation-next-turn-debt')) {
    delayed.push({
      id: 'iop-precipitation-next-turn-debt',
      scope: 'self',
      stats: { ap: -5 },
      delayTurns: 1,
      durationTurns: 1,
      stacking: 'replace-source'
    });
  }
  return {
    ...spell,
    combatModifiers: (spell.combatModifiers || []).map(cloneModifier),
    delayedCombatModifiers: delayed,
    curatedCombatRule: 'precipitation-plus-5-ap-then-minus-5-ap-next-turn',
    combatRelevant: true
  };
}

function accumulationRule(spell) {
  return {
    ...spell,
    // Accumulation can target the Iop instead of an enemy. The self-cast deals
    // no damage and charges the next Accumulation casts for three turns. The
    // combat solver models the charge as state rather than pretending this is a
    // direct stat buff, because it only modifies this spell's base damage.
    selfCharge: {
      id: 'iop-accumulation-charge',
      targetSpellId: String(spell.id || 'spell-13138'),
      durationTurns: 3,
      baseDamageBonus: 20,
      critBaseDamageBonus: 24,
      maxStacks: 1
    },
    curatedCombatRule: 'accumulation-self-charge',
    combatRelevant: true
  };
}

export function applyCuratedSpellRules(spell = {}) {
  const ankamaId = Number(spell?.ankamaId);
  if (ankamaId === CONCENTRATION_ANKAMA_ID) return concentrationRule(spell);
  if (ankamaId === PRECIPITATION_ANKAMA_ID) return precipitationRule(spell);
  if (ankamaId === ACCUMULATION_ANKAMA_ID) return accumulationRule(spell);
  return spell;
}
