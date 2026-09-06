import { BASE_CHARACTER, SLOT_RULES } from './config.js';
import { FM_ELIGIBLE_SLOTS } from './fm.js';
import { spellDamageUpperBound } from './spells.js';
import { optimisticItemStats } from './search-space.js';
import { CombatEffectType, spellCombatEffects } from './combat/effects.js';
import { defaultCombatMechanicsRegistry } from './combat/mechanics/default-registry.js';
import { mechanicContextForSpell } from './combat/mechanics/registry.js';
import { GENERIC_OFFENSE_KEYS } from '../optimizer/candidate-policy.js';
import { getSearchProfile } from '../optimizer/search-profiles.js';

const ELEMENTS = Object.freeze(['earth', 'fire', 'water', 'air']);
const ELEMENT_DAMAGE_KEYS = Object.freeze([
  'damageEarth', 'damageNeutral', 'damageFire', 'damageWater', 'damageAir'
]);

export const COMBAT_T1_BOUND_STAT_KEYS = Object.freeze([
  ...new Set([
    ...GENERIC_OFFENSE_KEYS,
    ...ELEMENTS,
    ...ELEMENT_DAMAGE_KEYS,
    'power',
    'damage',
    'crit',
    'critDamage',
    'spellDamagePct',
    'weaponDamagePct',
    'meleeDamagePct',
    'rangedDamagePct',
    'finalDamagePct',
    'finalDamagePctT1'
  ])
]);

function num(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function positiveInt(value, fallback = 1) {
  return Math.max(1, Math.floor(num(value, fallback)));
}

function addPositive(target, source = {}, multiplier = 1) {
  for (const [key, raw] of Object.entries(source || {})) {
    const value = num(raw, 0) * multiplier;
    if (!(value > 0)) continue;
    target[key] = num(target[key], 0) + value;
  }
  return target;
}

function maxPositive(target, source = {}) {
  for (const [key, raw] of Object.entries(source || {})) {
    const value = num(raw, 0);
    if (!(value > 0)) continue;
    target[key] = Math.max(num(target[key], 0), value);
  }
  return target;
}

function positiveSetBonusCaps(sets = [], keys = COMBAT_T1_BOUND_STAT_KEYS) {
  const result = Object.fromEntries(keys.map((key) => [key, 0]));
  for (const set of sets || []) {
    for (const key of keys) {
      let best = 0;
      for (const bonus of Object.values(set?.bonuses || {})) {
        best = Math.max(best, Math.max(0, num(bonus?.[key], 0)));
      }
      result[key] += best;
    }
  }
  return result;
}

function forgeableSlotCount() {
  return SLOT_RULES.reduce((sum, rule) => {
    return sum + (FM_ELIGIBLE_SLOTS.has(rule.id) ? Math.max(0, num(rule.count, 0)) : 0);
  }, 0);
}

function visitEffect(effect, envelope) {
  if (!effect || typeof effect !== 'object') return;
  if (effect.type === CombatEffectType.CONDITIONAL) {
    for (const nested of effect.effects || []) visitEffect(nested, envelope);
    return;
  }
  if (effect.type === CombatEffectType.DELAYED_EFFECT) {
    visitEffect(effect.effect, envelope);
    return;
  }
  if (effect.type === CombatEffectType.STAT_MODIFIER) {
    addPositive(envelope.selfStats, effect.stats || {});
    return;
  }
  if (effect.type === CombatEffectType.TARGET_MODIFIER) {
    addPositive(envelope.targetStats, effect.stats || {});
    return;
  }
  if (effect.type === CombatEffectType.SPELL_CHARGE) {
    envelope.chargeBaseDamage = Math.max(
      envelope.chargeBaseDamage,
      Math.max(0, num(effect.baseDamageBonus, 0)),
      Math.max(0, num(effect.critBaseDamageBonus, 0))
    );
  }
}

function perActionSupportEnvelope(spells = []) {
  const maximum = { selfStats: {}, targetStats: {}, chargeBaseDamage: 0 };
  for (const spell of spells || []) {
    const oneCast = { selfStats: {}, targetStats: {}, chargeBaseDamage: 0 };
    for (const effect of spellCombatEffects(spell)) visitEffect(effect, oneCast);
    maxPositive(maximum.selfStats, oneCast.selfStats);
    maxPositive(maximum.targetStats, oneCast.targetStats);
    maximum.chargeBaseDamage = Math.max(maximum.chargeBaseDamage, oneCast.chargeBaseDamage);
  }
  return maximum;
}

function spellMatchesElement(spell, element = 'multi') {
  if (element === 'multi' || !element) return Array.isArray(spell?.hits) && spell.hits.length > 0;
  return (spell?.hits || []).some((hit) => hit?.element === element);
}

function combatSpellPool(classSpells = [], combatObjective = {}) {
  const element = combatObjective?.element || 'multi';
  return (classSpells || []).filter((spell) => {
    const support = (Array.isArray(spell?.combatModifiers) && spell.combatModifiers.length > 0)
      || (Array.isArray(spell?.delayedCombatModifiers) && spell.delayedCombatModifiers.length > 0)
      || Boolean(spell?.selfCharge);
    return support || spellMatchesElement(spell, element);
  });
}

function hasOpaqueMechanicHook(spells = []) {
  return (spells || []).some((spell) => {
    const context = mechanicContextForSpell(spell);
    return defaultCombatMechanicsRegistry.matching(context).some((definition) => {
      return Object.values(definition?.hooks || {}).some((hook) => typeof hook === 'function');
    });
  });
}

function addChargeToRange(range, amount) {
  if (!Array.isArray(range)) return range;
  return range.map((value) => num(value, 0) + amount);
}

function spellWithOptimisticCharge(spell, amount) {
  if (!(amount > 0) || !(spell?.hits || []).length) return spell;
  return {
    ...spell,
    hits: spell.hits.map((hit) => ({
      ...hit,
      normal: addChargeToRange(hit.normal, amount),
      crit: addChargeToRange(hit.crit ?? hit.normal, amount)
    }))
  };
}

function optimisticSelectedStats(items, { turnMode, scenario }, optimisticItemCache = null) {
  const stats = {};
  addPositive(stats, BASE_CHARACTER.baseStats || {});
  for (const element of ELEMENTS) {
    stats[element] = num(stats[element], 0) + Math.max(0, num(BASE_CHARACTER.scrolled?.[element], 0));
  }

  for (const item of items || []) {
    let optimistic = optimisticItemCache?.get(item);
    if (optimistic === undefined) {
      optimistic = optimisticItemStats(item, {
        includePassives: true,
        turnMode,
        scenario
      });
      optimisticItemCache?.set(item, optimistic);
    }
    if (!optimistic?.bounded) return null;
    addPositive(stats, optimistic.stats || {});
  }
  return stats;
}

export function createCombatT1UpperBoundContext({
  classSpells = [],
  combatObjective = {},
  scenario = {},
  searchProfile = 'BALANCED',
  sets = [],
  fmPolicy = {}
} = {}) {
  const preparedSpells = combatSpellPool(classSpells, combatObjective)
    .map((spell) => defaultCombatMechanicsRegistry.prepareSpell(spell));
  const profile = getSearchProfile(searchProfile);
  const maxActions = positiveInt(profile?.combat?.maxActionsPerTurn, 12);
  const supportPerAction = perActionSupportEnvelope(preparedSpells);
  const supportSelfStats = {};
  const supportTargetStats = {};
  addPositive(supportSelfStats, supportPerAction.selfStats, maxActions);
  addPositive(supportTargetStats, supportPerAction.targetStats, maxActions);

  return Object.freeze({
    preparedSpells,
    maxActions,
    targetMode: combatObjective?.targetMode === 'zone' ? 'zone' : 'single',
    areaTargets: positiveInt(combatObjective?.areaTargets, 3),
    supportSelfStats: Object.freeze(supportSelfStats),
    supportTargetStats: Object.freeze(supportTargetStats),
    chargeBaseDamage: Math.max(0, supportPerAction.chargeBaseDamage) * maxActions,
    setCaps: Object.freeze(positiveSetBonusCaps(sets)),
    forgeable: forgeableSlotCount(),
    fmSpellDamagePct: Math.max(0, num(fmPolicy?.spellDamagePct, 0)),
    fmCritDamage: Math.max(0, num(fmPolicy?.critDamageAmount ?? 8, 8)),
    scenario,
    opaqueMechanics: hasOpaqueMechanicHook(preparedSpells)
  });
}

export function combatT1UpperBound({
  items = [],
  remainingCaps = null,
  policy,
  context,
  optimisticItemCache = null
} = {}) {
  if (!context || context.opaqueMechanics) return Infinity;
  if (!remainingCaps || remainingCaps.bounded === false || remainingCaps.impossibleShape === true) return Infinity;
  if (!(context.preparedSpells || []).some((spell) => (spell?.hits || []).length > 0)) return Infinity;

  const stats = optimisticSelectedStats(items, {
    turnMode: policy?.turnMode || 't1',
    scenario: policy?.scenario || context.scenario || {}
  }, optimisticItemCache);
  if (!stats) return Infinity;

  addPositive(stats, remainingCaps.caps || {});
  addPositive(stats, context.setCaps || {});

  const characteristicPoints = Math.max(0, num(BASE_CHARACTER.characteristicPoints, 0));
  for (const element of ELEMENTS) stats[element] = num(stats[element], 0) + characteristicPoints;

  stats.spellDamagePct = num(stats.spellDamagePct, 0) + context.forgeable * context.fmSpellDamagePct;
  stats.critDamage = num(stats.critDamage, 0) + context.forgeable * context.fmCritDamage;
  stats.crit = num(stats.crit, 0) + 100;
  addPositive(stats, context.supportSelfStats || {});

  const targetAdditive = Math.max(0, num(context.supportTargetStats?.finalDamageTakenPct, 0));
  const targetMultiplicative = Math.max(0, num(context.supportTargetStats?.finalDamageTakenMultiplierPct, 0));
  const targetMultiplier = (1 + targetAdditive / 100) * (1 + targetMultiplicative / 100);

  let bestPerAction = 0;
  for (const spell of context.preparedSpells || []) {
    if (!(spell?.hits || []).length) continue;
    const charged = spellWithOptimisticCharge(spell, context.chargeBaseDamage);
    let damage = spellDamageUpperBound(charged, stats, 1);
    if (context.targetMode === 'zone' && spell.isArea) damage *= context.areaTargets;
    bestPerAction = Math.max(bestPerAction, damage * targetMultiplier);
  }

  const totalDamageBound = bestPerAction * context.maxActions;
  return Number.isFinite(totalDamageBound) ? totalDamageBound : Infinity;
}
