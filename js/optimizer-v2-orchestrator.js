import { TURN_MODES } from './config.js';
import { activeMinimumConstraints } from './min-conditions.js';
import { MIN_CONDITION_KEYS } from './stat-catalog.js';
import { combatSpellsForElement } from './spell-selection.js';

export const OPTIMIZER_V2_ELEMENTS = Object.freeze([
  ['earth', 'Terre'],
  ['fire', 'Feu'],
  ['water', 'Eau'],
  ['air', 'Air'],
  ['multi', 'Multi']
]);

export const OPTIMIZER_V2_CONSTRAINT_KEYS = Object.freeze([...MIN_CONDITION_KEYS]);

const ELEMENT_IDS = new Set(OPTIMIZER_V2_ELEMENTS.map(([id]) => id));
const TURN_MODE_IDS = new Set(TURN_MODES.map(([id]) => id));

function nonNegativeNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

function normalizeItemIds(value = []) {
  return [...new Set((value || []).map(String).filter(Boolean))].sort();
}

function normalizeLockedItemsBySlot(value = {}) {
  return Object.fromEntries(Object.entries(value || {})
    .map(([slotKey, itemId]) => [String(slotKey), String(itemId || '')])
    .filter(([, itemId]) => Boolean(itemId))
    .sort(([left], [right]) => left.localeCompare(right)));
}

export function normalizeOptimizerV2Constraints(constraints = {}) {
  const withGenericMinimums = activeMinimumConstraints(constraints);
  return Object.fromEntries(
    OPTIMIZER_V2_CONSTRAINT_KEYS.map((key) => [key, nonNegativeNumber(withGenericMinimums?.[key])])
  );
}

export function normalizeOptimizerV2FmPolicy(fmPolicy = {}) {
  return {
    spellDamagePct: Number(fmPolicy?.spellDamagePct || 0) > 0 ? 3 : 0,
    allowCritDamage: fmPolicy?.allowCritDamage === true,
    critDamageAmount: 8,
    exoAp: Number(fmPolicy?.exoAp || 0) === 1 ? 1 : 0,
    exoMp: Number(fmPolicy?.exoMp || 0) === 1 ? 1 : 0
  };
}

export function formatOptimizerV2FmSummary(fmPolicy = {}) {
  const normalized = normalizeOptimizerV2FmPolicy(fmPolicy);
  if (!normalized.exoAp && !normalized.exoMp && !normalized.spellDamagePct && !normalized.allowCritDamage) {
    return 'FM : aucune';
  }
  return [
    `PA ${normalized.exoAp ? '+1' : 'OFF'}`,
    `PM ${normalized.exoMp ? '+1' : 'OFF'}`,
    `Do Sorts ${normalized.spellDamagePct ? '+3% / slot' : 'OFF'}`,
    `Do Crit ${normalized.allowCritDamage ? '+8' : 'OFF'}`
  ].join(' · ')
    .replace(/^/, 'FM : ');
}

export function createOptimizerV2Request({
  dataset,
  spellData,
  classId,
  element = 'earth',
  constraints = {},
  fmPolicy = {},
  turnMode = 'sum',
  topN = 10,
  lockedItemsBySlot = {},
  rejectedItemIds = []
} = {}) {
  const normalizedClassId = String(classId || '');
  if (!normalizedClassId || !(spellData?.breeds || []).some((breed) => String(breed.id) === normalizedClassId)) {
    throw new Error('Sélectionne une classe valide.');
  }

  const normalizedElement = ELEMENT_IDS.has(String(element)) ? String(element) : 'earth';
  const normalizedTurnMode = TURN_MODE_IDS.has(String(turnMode)) ? String(turnMode) : 'sum';
  const classSpells = combatSpellsForElement(spellData, normalizedClassId, normalizedElement);
  const normalizedLocks = normalizeLockedItemsBySlot(lockedItemsBySlot);
  const requiredItemIds = normalizeItemIds(Object.values(normalizedLocks));
  const normalizedRejected = normalizeItemIds(rejectedItemIds);
  const rejected = new Set(normalizedRejected);
  const conflict = requiredItemIds.find((itemId) => rejected.has(itemId));
  if (conflict) throw new Error(`Un item ne peut pas être à la fois locké et rejeté (${conflict}).`);
  const catalogItems = dataset?.items || [];

  return {
    classId: normalizedClassId,
    items: normalizedRejected.length ? catalogItems.filter((item) => !rejected.has(String(item?.id))) : catalogItems,
    sets: dataset?.sets || [],
    selections: [],
    classSpells,
    objectiveMode: 'combat',
    combatObjective: {
      element: normalizedElement,
      turnMode: normalizedTurnMode,
      targetMode: 'single',
      areaTargets: 3,
      allowSupport: true,
      metric: 'total-damage'
    },
    constraints: normalizeOptimizerV2Constraints(constraints),
    fmPolicy: normalizeOptimizerV2FmPolicy(fmPolicy),
    turnMode: normalizedTurnMode,
    scenario: { requiredApByTurn: {} },
    diversityMode: 'gear',
    searchProfile: 'BALANCED',
    topN: Math.max(1, Number(topN || 10)),
    requiredItemIds,
    lockedItemsBySlot: normalizedLocks,
    rejectedItemIds: normalizedRejected
  };
}
