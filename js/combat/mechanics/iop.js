const SPELLS = Object.freeze({
  CONCENTRATION: 13123,
  PRECIPITATION: 13114,
  ACCUMULATION: 13138
});

function spellMatcher(ankamaId) {
  return { spellIds: [`spell-${ankamaId}`] };
}

function cloneModifier(modifier) {
  return { ...modifier, stats: { ...(modifier.stats || {}) } };
}

function concentration(spell) {
  const hits = Array.isArray(spell.hits) ? spell.hits : [];
  if (hits.length <= 1) return spell;
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

function precipitation(spell) {
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

function accumulation(spell) {
  return {
    ...spell,
    selfCharge: {
      id: 'iop-accumulation-charge',
      targetSpellId: String(spell.id || `spell-${SPELLS.ACCUMULATION}`),
      durationTurns: 3,
      baseDamageBonus: 20,
      critBaseDamageBonus: 24,
      maxStacks: 1
    },
    curatedCombatRule: 'accumulation-self-charge',
    combatRelevant: true
  };
}

export const iopMechanics = Object.freeze([
  Object.freeze({
    id: 'iop-concentration-normal-target',
    matcher: spellMatcher(SPELLS.CONCENTRATION),
    prepareSpell: concentration
  }),
  Object.freeze({
    id: 'iop-precipitation-temporal-ap',
    matcher: spellMatcher(SPELLS.PRECIPITATION),
    prepareSpell: precipitation
  }),
  Object.freeze({
    id: 'iop-accumulation-charge',
    matcher: spellMatcher(SPELLS.ACCUMULATION),
    prepareSpell: accumulation
  })
]);
