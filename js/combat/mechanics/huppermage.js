import { CombatEffectType, combatStateValue } from '../effects.js';

const BREED_IDS = Object.freeze([17, 'breed-17']);
const ONE_OF_ELEMENT_SPELL_IDS = Object.freeze([
  'spell-13670',
  'spell-13672',
  'spell-13683',
  'spell-13710',
  'spell-13724',
  'spell-14342'
]);
const ELEMENT_STATE_KEY = 'huppermage:last-element';
const ELEMENTS = new Set(['earth', 'fire', 'water', 'air']);

function pairActivatesVolcanic(first, second) {
  return (first === 'earth' && second === 'fire') || (first === 'fire' && second === 'earth');
}

function prepareOneOfElementSpell(spell) {
  return {
    ...spell,
    damageSelection: 'one-of-elements',
    curatedDamageRule: 'one-of-element-damage',
    mechanicTags: [...new Set([...(spell.mechanicTags || []), 'one-of-element-damage'])]
  };
}

function elementalCombinationEffects({ state, variant, turn }) {
  const element = variant?.element;
  if (!ELEMENTS.has(element)) return [];
  const previous = combatStateValue(state.combatStates, ELEMENT_STATE_KEY, turn);
  const effects = [{
    type: CombatEffectType.STATE,
    id: ELEMENT_STATE_KEY,
    key: ELEMENT_STATE_KEY,
    value: { element },
    durationTurns: 1
  }];
  if (pairActivatesVolcanic(previous?.element, element)) {
    effects.push({
      type: CombatEffectType.TARGET_MODIFIER,
      id: 'huppermage-volcanic-vulnerability',
      stats: { finalDamageTakenMultiplierPct: 15 },
      durationTurns: 1,
      stacking: 'replace-source'
    });
  }
  return effects;
}

export const huppermageMechanics = Object.freeze([
  Object.freeze({
    id: 'huppermage-one-of-element-damage',
    matcher: { spellIds: ONE_OF_ELEMENT_SPELL_IDS },
    prepareSpell: prepareOneOfElementSpell
  }),
  Object.freeze({
    id: 'huppermage-element-combination',
    matcher: { breedIds: BREED_IDS },
    prepareSpell: (spell) => ({ ...spell, curatedCombatRule: spell.curatedCombatRule || 'element-combination-state' }),
    hooks: Object.freeze({ afterDamage: elementalCombinationEffects })
  })
]);
