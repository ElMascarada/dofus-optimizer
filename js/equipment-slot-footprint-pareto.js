import { countSetBonuses, isPrysmaradite } from './build-legality.js';
import { FM_ELIGIBLE_SLOTS } from './fm.js';
import { constraintStatContribution, stat } from './stats.js';
import { staticBuildStats } from '../optimizer/candidate-search.js';
import { positiveConstraintKeys } from '../optimizer/candidate-policy.js';

const EQUIPMENT_SLOT_ORDER = Object.freeze(['hat', 'cape', 'amulet', 'belt', 'boots', 'weapon', 'ring', 'shield']);
const EQUIPMENT_SLOT_RANK = new Map(EQUIPMENT_SLOT_ORDER.map((slot, index) => [slot, index]));
const EQUIPMENT_SLOTS = new Set(EQUIPMENT_SLOT_ORDER);
const NON_MONOTONE_OPERATORS = new Set(['lt', 'lte', 'eq', 'neq']);
const LOWER_BOUND_OPERATORS = new Set(['gt', 'gte']);
const SCORE_EPSILON = 1e-9;

function stableJson(value) {
  if (value == null) return 'null';
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (typeof value !== 'object') return JSON.stringify(value);
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
}

function normalizeNoCrit(scenario = {}) {
  return scenario?.noCrit === true
    || String(scenario?.critMode || '').toLowerCase() === 'no-crit'
    || String(scenario?.criticalMode || '').toLowerCase() === 'no-crit';
}

function rangeEndpoint(range, index) {
  if (Array.isArray(range)) return Number(range[index] ?? range[0] ?? 0);
  return Number(range || 0);
}

function critIsMonotoneForSelections(selections = []) {
  for (const selection of selections || []) {
    if (!selection?.enabled) continue;
    for (const hit of selection.spell?.hits || []) {
      const normal = hit.normal || [0, 0];
      const critical = hit.crit ?? normal;
      if (rangeEndpoint(critical, 0) < rangeEndpoint(normal, 0)) return false;
      if (rangeEndpoint(critical, 1) < rangeEndpoint(normal, 1)) return false;
    }
  }
  return true;
}

function damageElementStat(element = 'earth') {
  return element === 'neutral' ? 'earth' : element;
}

function flatDamageStat(element = 'earth') {
  if (element === 'neutral') return 'damageNeutral';
  return `damage${element.charAt(0).toUpperCase()}${element.slice(1)}`;
}

export function combatT1ParetoDimensions(selections = [], constraints = {}, scenario = {}) {
  const dimensions = new Set(positiveConstraintKeys(constraints));
  const equalityKeys = new Set(['ap']);
  const noCrit = normalizeNoCrit(scenario);
  let hasDamage = false;

  for (const selection of selections || []) {
    if (!selection?.enabled) continue;
    const spell = selection.spell || {};
    const hits = spell.hits || [];
    if (!hits.length) continue;
    hasDamage = true;
    dimensions.add('power');
    dimensions.add('damage');
    if (!noCrit) dimensions.add('critDamage');
    dimensions.add('finalDamagePct');
    dimensions.add('finalDamagePctT1');
    dimensions.add(spell.damageSource === 'weapon' ? 'weaponDamagePct' : 'spellDamagePct');
    for (const hit of hits) {
      dimensions.add(damageElementStat(hit?.element || 'earth'));
      dimensions.add(flatDamageStat(hit?.element || 'earth'));
    }
    const options = Array.isArray(spell.distanceOptions) ? spell.distanceOptions : [];
    if (options.includes('melee')) dimensions.add('meleeDamagePct');
    if (options.includes('ranged')) dimensions.add('rangedDamagePct');
  }

  if (!noCrit && hasDamage) {
    if (critIsMonotoneForSelections(selections)) dimensions.add('crit');
    else equalityKeys.add('crit');
  } else if (positiveConstraintKeys(constraints).includes('crit')) {
    dimensions.add('crit');
  }

  // Permanent AP has an enforced upper legality cap. Never use AP as a
  // monotone destructive dimension, even when it is also an active floor.
  dimensions.delete('ap');
  return { dimensions, equalityKeys, noCrit, critMonotone: noCrit || critIsMonotoneForSelections(selections) };
}

function walkCondition(node, visit) {
  if (!node) return true;
  if (node.kind === 'relation') {
    if (!['and', 'or'].includes(node.relation)) return false;
    return (node.children || []).every((child) => walkCondition(child, visit));
  }
  return visit(node) !== false;
}

function collectConditionSemantics(items = []) {
  const monotoneKeys = new Set();
  const equalityKeys = new Set();
  let setBonusRelevant = false;
  let understood = true;

  for (const item of items || []) {
    if (!item?.conditions) continue;
    const okay = walkCondition(item.conditions, (condition) => {
      const key = condition?.stat;
      const operator = condition?.operator;
      if (!key || !operator) return false;
      if (key === 'level') return true;
      if (key === 'setBonus') {
        setBonusRelevant = true;
        return LOWER_BOUND_OPERATORS.has(operator) || NON_MONOTONE_OPERATORS.has(operator);
      }
      if (LOWER_BOUND_OPERATORS.has(operator)) {
        monotoneKeys.add(key);
        return true;
      }
      if (NON_MONOTONE_OPERATORS.has(operator)) {
        equalityKeys.add(key);
        return true;
      }
      return false;
    });
    if (!okay) understood = false;
  }

  for (const key of equalityKeys) monotoneKeys.delete(key);
  return { monotoneKeys, equalityKeys, setBonusRelevant, understood };
}

function dynamicEffectIsOpaque(item = {}) {
  return Boolean(
    (item.passives || []).length
    || (item.effects || []).length
    || Object.keys(item.turnBonuses || {}).length
    || (item.pendingDynamicEffects || []).length
  );
}

function unknownCommonDynamicEffect(item = {}) {
  return Boolean((item.effects || []).length || (item.pendingDynamicEffects || []).length);
}

function conditionSignature(items = []) {
  return stableJson((items || [])
    .filter((item) => item?.conditions)
    .map((item) => ({ slot: item.slot || null, conditions: item.conditions }))
    .sort((a, b) => String(a.slot).localeCompare(String(b.slot)) || stableJson(a.conditions).localeCompare(stableJson(b.conditions))));
}

function subtypeSignature(items = []) {
  return (items || [])
    .filter((item) => EQUIPMENT_SLOTS.has(item?.slot) && item?.slotSubtype)
    .map((item) => `${item.slot}:${item.slotSubtype}`)
    .sort()
    .join('|');
}

function nativeCritDamageFmCount(items = []) {
  return (items || []).filter((item) => FM_ELIGIBLE_SLOTS.has(item?.slot) && stat(item?.stats || {}, 'critDamage') !== 0).length;
}

export function canonicalEquipmentFootprint(items = []) {
  return (items || [])
    .filter((item) => EQUIPMENT_SLOTS.has(item?.slot))
    .map((item) => String(item.slot))
    .sort((left, right) => (EQUIPMENT_SLOT_RANK.get(left) ?? 99) - (EQUIPMENT_SLOT_RANK.get(right) ?? 99)
      || left.localeCompare(right))
    .join('|');
}

function completionHasSetContinuation(items = []) {
  return (items || []).some((item) => Boolean(item?.setId));
}

function valuesForKeys(stats, keys = []) {
  return Object.fromEntries([...keys].sort().map((key) => [key, constraintStatContribution(stats, key)]));
}

function compatibilityKey({
  footprint,
  stats,
  selectedItems,
  equipmentItems,
  equalityKeys,
  setBonusRelevant,
  fmPolicy = {}
}) {
  const equalityStats = valuesForKeys(stats, equalityKeys);
  const fmRelevant = Number(fmPolicy?.spellDamagePct || 0) > 0 || fmPolicy?.allowCritDamage === true;
  return stableJson({
    footprint,
    equalityStats,
    setBonus: setBonusRelevant ? countSetBonuses(selectedItems) : null,
    prysmaradites: selectedItems.filter(isPrysmaradite).length,
    equipmentSubtypes: subtypeSignature(equipmentItems),
    equipmentConditions: conditionSignature(equipmentItems),
    nativeCritDamageFmCount: fmRelevant ? nativeCritDamageFmCount(equipmentItems) : null
  });
}

export function createEquipmentParetoProfile({
  items = [],
  requiredItemIds = [],
  completionItems = [],
  setsById = {},
  selections = [],
  constraints = {},
  scenario = {},
  fmPolicy = {},
  structureResolved = true
} = {}) {
  const required = new Set((requiredItemIds || []).map(String));
  const equipmentItems = items.filter((item) => EQUIPMENT_SLOTS.has(item?.slot));
  const variableEquipment = equipmentItems.filter((item) => !required.has(String(item?.id)));
  const commonRequired = items.filter((item) => required.has(String(item?.id)));
  const footprint = canonicalEquipmentFootprint(equipmentItems);
  const objective = combatT1ParetoDimensions(selections, constraints, scenario);
  const conditionItems = [...commonRequired, ...variableEquipment, ...(completionItems || [])];
  const conditionSemantics = collectConditionSemantics(conditionItems);
  const equalityKeys = new Set([...objective.equalityKeys, ...conditionSemantics.equalityKeys]);
  const dimensions = new Set([...objective.dimensions, ...conditionSemantics.monotoneKeys]);
  for (const key of equalityKeys) dimensions.delete(key);
  const futureSetContinuation = completionHasSetContinuation(completionItems);
  const opaqueReason = !structureResolved
    ? 'partial-equipment-structure'
    : !conditionSemantics.understood
      ? 'opaque-condition'
      : futureSetContinuation
        ? 'future-set-continuation'
        : commonRequired.some(unknownCommonDynamicEffect)
          ? 'opaque-common-dynamic-effect'
          : variableEquipment.some(dynamicEffectIsOpaque)
            ? 'opaque-dynamic-effect'
            : null;
  const stats = staticBuildStats(items, setsById);
  const key = compatibilityKey({
    footprint,
    stats,
    selectedItems: items,
    equipmentItems,
    equalityKeys,
    setBonusRelevant: conditionSemantics.setBonusRelevant,
    fmPolicy
  });
  return {
    items: [...items],
    stats,
    footprint,
    compatibilityKey: key,
    dimensions: [...dimensions].sort(),
    vector: valuesForKeys(stats, dimensions),
    opaque: Boolean(opaqueReason),
    opaqueReason,
    noCrit: objective.noCrit,
    critMonotone: objective.critMonotone
  };
}

export function equipmentProfileDominates(left, right) {
  if (!left || !right || left.opaque || right.opaque) return false;
  // The final rescue breaks equal scores by the lexical item-id build key. A
  // vector improvement can be score-neutral after DOFUS integer rounding, so
  // never remove a lexically earlier structure in favour of a later one.
  if (structureKey(left.items).localeCompare(structureKey(right.items)) > 0) return false;
  if (left.footprint !== right.footprint) return false;
  if (left.compatibilityKey !== right.compatibilityKey) return false;
  if (left.dimensions.join('|') !== right.dimensions.join('|')) return false;
  let strictlyBetter = false;
  for (const key of left.dimensions) {
    const a = Number(left.vector?.[key] || 0);
    const b = Number(right.vector?.[key] || 0);
    if (a + SCORE_EPSILON < b) return false;
    if (a > b + SCORE_EPSILON) strictlyBetter = true;
  }
  return strictlyBetter;
}

function structureKey(items = []) {
  return items.map((item) => String(item?.id)).sort().join('|');
}

export function createEquipmentParetoReducer(options = {}) {
  const partitions = new Map();
  const opaque = [];
  let sequence = 0;
  let structures = 0;
  let comparable = 0;
  let dominated = 0;
  let opaqueKept = 0;

  function consider(items = []) {
    structures++;
    const profile = createEquipmentParetoProfile({ ...options, items, structureResolved: true });
    const entry = { sequence: sequence++, items: [...items], profile };
    if (profile.opaque) {
      opaque.push(entry);
      opaqueKept++;
      return { kept: true, dominated: false, opaque: true };
    }
    const partitionKey = `${profile.footprint}::${profile.compatibilityKey}`;
    const frontier = partitions.get(partitionKey) || [];
    for (const current of frontier) {
      comparable++;
      if (equipmentProfileDominates(current.profile, profile)) {
        dominated++;
        return { kept: false, dominated: true, opaque: false };
      }
    }
    const survivors = [];
    for (const current of frontier) {
      comparable++;
      if (equipmentProfileDominates(profile, current.profile)) dominated++;
      else survivors.push(current);
    }
    survivors.push(entry);
    partitions.set(partitionKey, survivors);
    return { kept: true, dominated: false, opaque: false };
  }

  function entries() {
    return [...opaque, ...[...partitions.values()].flat()]
      .sort((a, b) => a.sequence - b.sequence || structureKey(a.items).localeCompare(structureKey(b.items)));
  }

  function diagnostics() {
    const current = entries();
    return {
      constraintRescueEquipmentStructures: structures,
      constraintRescueParetoComparable: comparable,
      constraintRescueParetoDominated: dominated,
      constraintRescueParetoFrontier: current.length,
      constraintRescueParetoOpaqueKept: opaqueKept
    };
  }

  function debugTop(limit = 8) {
    return entries().slice(0, Math.max(0, Number(limit || 0))).map((entry) => ({
      itemIds: entry.items.map((item) => String(item.id)).sort(),
      footprint: entry.profile.footprint,
      legalityCompatibilityKey: entry.profile.compatibilityKey,
      opaque: entry.profile.opaque,
      opaqueReason: entry.profile.opaqueReason,
      vector: { ...entry.profile.vector }
    }));
  }

  return { consider, entries, diagnostics, debugTop };
}
