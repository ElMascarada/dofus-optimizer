import { countSetBonuses, isPrysmaradite } from './build-legality.js';
import { FM_ELIGIBLE_SLOTS } from './fm.js';
import { constraintStatContribution, stat } from './stats.js';
import { staticBuildStats } from '../optimizer/candidate-search.js';
import { positiveConstraintKeys } from '../optimizer/candidate-policy.js';

const EQUIPMENT_SLOT_ORDER = Object.freeze(['hat', 'cape', 'amulet', 'belt', 'boots', 'weapon', 'ring', 'shield']);
const EQUIPMENT_SLOT_RANK = new Map(EQUIPMENT_SLOT_ORDER.map((slot, index) => [slot, index]));
const EQUIPMENT_SLOTS = new Set(EQUIPMENT_SLOT_ORDER);
const MONO_ELEMENTS = new Set(['earth', 'fire', 'water', 'air']);
const NON_MONOTONE_OPERATORS = new Set(['lt', 'lte', 'eq', 'neq']);
const LOWER_BOUND_OPERATORS = new Set(['gt', 'gte']);
const SCORE_EPSILON = 1e-9;

function stableJson(value) {
  if (value == null) return 'null';
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (typeof value !== 'object') return JSON.stringify(value);
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
}

function damageElementStat(element = 'earth') {
  return element === 'neutral' ? 'earth' : element;
}

function flatDamageStat(element = 'earth') {
  if (element === 'neutral') return 'damageNeutral';
  return `damage${element.charAt(0).toUpperCase()}${element.slice(1)}`;
}

function enabledDamageSelections(selections = []) {
  return (selections || []).filter((selection) => selection?.enabled && (selection.spell?.hits || []).length > 0);
}

function objectiveSemantics(selections = [], combatObjective = {}) {
  const requested = String(combatObjective?.element || '').toLowerCase();
  if (MONO_ELEMENTS.has(requested)) {
    // Destructive Pareto must match the canonical scorer. A mixed-hit spell can
    // still score its off-element lines in refineCombatTurns(), so until the
    // scorer has an explicit mono-element variant contract we keep such states.
    const certified = enabledDamageSelections(selections).every((selection) => {
      return (selection.spell?.hits || []).every((hit) => damageElementStat(hit?.element || 'earth') === requested);
    });
    return { mode: 'mono', element: requested, certified };
  }
  if (requested === 'multi') return { mode: 'multi', element: null, certified: true };
  return { mode: 'unsupported', element: null, certified: false };
}

function offensiveHitsForObjective(spell = {}, objective = {}) {
  const hits = spell.hits || [];
  if (objective.mode === 'mono') {
    return hits.filter((hit) => damageElementStat(hit?.element || 'earth') === objective.element);
  }
  if (objective.mode === 'multi') return hits;
  return [];
}

export function combatT1ParetoDimensions(selections = [], constraints = {}, combatObjective = {}) {
  const dimensions = new Set(positiveConstraintKeys(constraints));
  // AP has a hard upper legality cap and Crit is not proven monotone once
  // critDamage (including negative values) participates in final damage.
  const equalityKeys = new Set(['ap', 'crit']);
  const objective = objectiveSemantics(selections, combatObjective);
  let hasDamage = false;

  for (const selection of selections || []) {
    if (!selection?.enabled) continue;
    const spell = selection.spell || {};
    const hits = offensiveHitsForObjective(spell, objective);
    if (!hits.length) continue;
    hasDamage = true;
    dimensions.add('power');
    dimensions.add('damage');
    dimensions.add('critDamage');
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

  // Crit is deliberately equality-only in destructive V1. A minimum Crit
  // constraint is therefore protected more conservatively than a Pareto axis.
  dimensions.delete('crit');
  dimensions.delete('ap');
  return {
    dimensions,
    equalityKeys,
    hasDamage,
    objectiveMode: objective.mode,
    objectiveElement: objective.element,
    objectiveCertified: objective.certified,
    critMonotone: false,
    noCritDestructiveHeuristic: false
  };
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
  combatObjective = {},
  fmPolicy = {},
  structureResolved = true
} = {}) {
  const required = new Set((requiredItemIds || []).map(String));
  const equipmentItems = items.filter((item) => EQUIPMENT_SLOTS.has(item?.slot));
  const variableEquipment = equipmentItems.filter((item) => !required.has(String(item?.id)));
  const commonRequired = items.filter((item) => required.has(String(item?.id)));
  const footprint = canonicalEquipmentFootprint(equipmentItems);
  const objective = combatT1ParetoDimensions(selections, constraints, combatObjective);
  const conditionItems = [...commonRequired, ...variableEquipment, ...(completionItems || [])];
  const conditionSemantics = collectConditionSemantics(conditionItems);
  const equalityKeys = new Set([...objective.equalityKeys, ...conditionSemantics.equalityKeys]);
  const dimensions = new Set([...objective.dimensions, ...conditionSemantics.monotoneKeys]);
  for (const key of equalityKeys) dimensions.delete(key);
  const futureSetContinuation = completionHasSetContinuation(completionItems);
  const opaqueReason = !structureResolved
    ? 'partial-equipment-structure'
    : !objective.objectiveCertified
      ? 'uncertified-objective-semantics'
      : !conditionSemantics.understood
        ? 'opaque-condition'
        : futureSetContinuation
          ? 'future-set-continuation'
          : commonRequired.some(dynamicEffectIsOpaque)
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
    objectiveMode: objective.objectiveMode,
    objectiveElement: objective.objectiveElement,
    critMonotone: false,
    noCritDestructiveHeuristic: false
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
      objectiveMode: entry.profile.objectiveMode,
      objectiveElement: entry.profile.objectiveElement,
      vector: { ...entry.profile.vector }
    }));
  }

  return { consider, entries, diagnostics, debugTop };
}
