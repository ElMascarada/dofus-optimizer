import { specialSlotRulesAreValid } from '../build-legality.js';
import { createCanonicalT1CombatContext } from '../combat-evaluation-context.js';

export const WORKSHOP_FM_POLICY = Object.freeze({
  spellDamagePct: 0,
  allowCritDamage: false,
  critDamageAmount: 8,
  structuralExos: false
});

export const WORKSHOP_SLOTS = Object.freeze([
  { key: 'hat', slot: 'hat', label: 'Coiffe' },
  { key: 'cape', slot: 'cape', label: 'Cape' },
  { key: 'amulet', slot: 'amulet', label: 'Amulette' },
  { key: 'ring-1', slot: 'ring', label: 'Anneau 1' },
  { key: 'ring-2', slot: 'ring', label: 'Anneau 2' },
  { key: 'belt', slot: 'belt', label: 'Ceinture' },
  { key: 'boots', slot: 'boots', label: 'Bottes' },
  { key: 'weapon', slot: 'weapon', label: 'Arme' },
  { key: 'shield', slot: 'shield', label: 'Bouclier' },
  { key: 'companion', slot: 'companion', label: 'Familier / monture' },
  ...Array.from({ length: 6 }, (_, index) => ({
    key: `dofus-${index + 1}`,
    slot: 'dofus',
    label: `Dofus / trophée ${index + 1}`
  }))
]);

const SLOT_BY_KEY = new Map(WORKSHOP_SLOTS.map((entry) => [entry.key, entry]));
const SLOT_KEYS_BY_SLOT = new Map();
for (const descriptor of WORKSHOP_SLOTS) {
  if (!SLOT_KEYS_BY_SLOT.has(descriptor.slot)) SLOT_KEYS_BY_SLOT.set(descriptor.slot, []);
  SLOT_KEYS_BY_SLOT.get(descriptor.slot).push(descriptor.key);
}

function cloneEquipment(equipmentBySlot = {}) {
  return Object.fromEntries(Object.entries(equipmentBySlot).filter(([, item]) => Boolean(item)));
}

function cloneCanonicalCombatContext(context = null) {
  if (!context || typeof context !== 'object') return null;
  return {
    ...context,
    combatObjective: { ...(context.combatObjective || {}) },
    scenario: {
      ...(context.scenario || {}),
      requiredApByTurn: { ...(context.scenario?.requiredApByTurn || {}) }
    },
    spellIds: [...(context.spellIds || [])],
    stats: { ...(context.stats || {}) },
    effectiveStatsByTurn: Object.fromEntries(Object.entries(context.effectiveStatsByTurn || {})
      .map(([turn, stats]) => [turn, { ...(stats || {}) }])),
    fm: context.fm ? { ...context.fm } : null
  };
}

function normalizeRejectedItemIds(ids = []) {
  return [...new Set((ids || []).map(String).filter(Boolean))].sort();
}

function normalizeLockedSlots(lockedSlots = [], equipmentBySlot = {}) {
  const equipped = new Set(Object.keys(equipmentBySlot || {}));
  return [...new Set((lockedSlots || []).map(String))]
    .filter((key) => SLOT_BY_KEY.has(key) && equipped.has(key))
    .sort();
}

export function workshopCombatSignature(build = {}) {
  const equipment = WORKSHOP_SLOTS.map(({ key }) => `${key}:${String(build?.equipmentBySlot?.[key]?.id || '')}`);
  const fmPolicy = Object.entries(build?.fmPolicy || {})
    .sort(([left], [right]) => left.localeCompare(right));
  const selectedSpells = [...new Set((build?.selectedSpells || []).map(String).filter(Boolean))].sort();
  return JSON.stringify({
    classId: build?.classId ? String(build.classId) : null,
    equipment,
    fmPolicy,
    selectedSpells
  });
}

export function createWorkshopBuild({
  classId = null,
  equipmentBySlot = {},
  fmPolicy = WORKSHOP_FM_POLICY,
  selectedSpells = [],
  lockedSlots = [],
  rejectedItemIds = [],
  canonicalCombatContext = null,
  canonicalCombatSignature = null
} = {}) {
  const equipment = cloneEquipment(equipmentBySlot);
  return {
    classId: classId ? String(classId) : null,
    equipmentBySlot: equipment,
    fmPolicy: { ...WORKSHOP_FM_POLICY, ...(fmPolicy || {}) },
    selectedSpells: [...new Set((selectedSpells || []).map(String))],
    lockedSlots: normalizeLockedSlots(lockedSlots, equipment),
    rejectedItemIds: normalizeRejectedItemIds(rejectedItemIds),
    canonicalCombatContext: cloneCanonicalCombatContext(canonicalCombatContext),
    canonicalCombatSignature: canonicalCombatSignature ? String(canonicalCombatSignature) : null
  };
}

export function workshopItems(build = {}) {
  return WORKSHOP_SLOTS
    .map(({ key }) => build?.equipmentBySlot?.[key])
    .filter(Boolean);
}

export function workshopSlot(slotKey) {
  return SLOT_BY_KEY.get(String(slotKey)) || null;
}

export function workshopLockedItemsBySlot(build = {}) {
  const locked = new Set(build?.lockedSlots || []);
  return Object.fromEntries(WORKSHOP_SLOTS
    .filter(({ key }) => locked.has(key) && build?.equipmentBySlot?.[key]?.id != null)
    .map(({ key }) => [key, String(build.equipmentBySlot[key].id)]));
}

export function workshopBuildIsComplete(build = {}) {
  return WORKSHOP_SLOTS.every(({ key }) => Boolean(build?.equipmentBySlot?.[key]));
}

export function createWorkshopBuildFromOptimizerResult({
  result,
  classId = null,
  fmPolicy = WORKSHOP_FM_POLICY,
  lockedItemsBySlot = {},
  rejectedItemIds = [],
  combatObjective = null,
  scenario = {},
  spellIds = [],
  searchProfile = 'BALANCED'
} = {}) {
  const equipmentBySlot = {};
  const resultItems = [...(result?.items || [])];
  const usedIndexes = new Set();
  const lockedSlots = [];

  for (const [slotKey, rawItemId] of Object.entries(lockedItemsBySlot || {})) {
    const descriptor = workshopSlot(slotKey);
    const itemId = String(rawItemId || '');
    if (!descriptor || !itemId) throw new Error(`Lock Atelier invalide : ${slotKey}.`);
    const index = resultItems.findIndex((item, candidateIndex) => !usedIndexes.has(candidateIndex) && String(item?.id) === itemId);
    if (index < 0) throw new Error(`Résultat incompatible avec le lock ${slotKey}.`);
    const item = resultItems[index];
    if (item?.slot !== descriptor.slot) throw new Error(`Résultat incompatible avec le slot locké ${slotKey}.`);
    equipmentBySlot[slotKey] = item;
    lockedSlots.push(slotKey);
    usedIndexes.add(index);
  }

  for (let index = 0; index < resultItems.length; index++) {
    if (usedIndexes.has(index)) continue;
    const item = resultItems[index];
    const slotKey = (SLOT_KEYS_BY_SLOT.get(item?.slot) || []).find((key) => !equipmentBySlot[key]);
    if (!slotKey) throw new Error(`Résultat incompatible avec l’Atelier : slot ${item?.slot || 'inconnu'} en surnombre.`);
    equipmentBySlot[slotKey] = item;
  }

  const selectedSpells = [...new Set(
    (result?.combatPlan?.sequence || [])
      .map((entry) => entry?.spellId ?? entry?.id)
      .filter(Boolean)
      .map(String)
  )];
  let build = createWorkshopBuild({
    classId,
    equipmentBySlot,
    fmPolicy,
    selectedSpells,
    lockedSlots,
    rejectedItemIds
  });
  if (!specialSlotRulesAreValid(workshopItems(build))) {
    throw new Error('Résultat incompatible avec les règles de slots de l’Atelier.');
  }

  const optimizerTurnMode = String(combatObjective?.turnMode || result?.combatPlan?.objective?.turnMode || '');
  const canonicalSpellIds = [...new Set((spellIds || []).map(String).filter(Boolean))];
  if (optimizerTurnMode === 't1' && canonicalSpellIds.length) {
    const canonicalCombatContext = createCanonicalT1CombatContext({
      classId,
      element: combatObjective?.element ?? null,
      combatObjective: {
        ...(combatObjective || {}),
        ...(result?.combatPlan?.objective || {}),
        turnMode: 't1'
      },
      scenario,
      spellIds: canonicalSpellIds,
      stats: result?.stats || {},
      effectiveStatsByTurn: result?.effectiveStatsByTurn || {},
      fm: result?.fm || null,
      searchProfile
    });
    build = createWorkshopBuild({
      ...build,
      canonicalCombatContext,
      canonicalCombatSignature: workshopCombatSignature(build)
    });
  }
  return build;
}

export function setWorkshopClass(build, classId) {
  return createWorkshopBuild({ ...build, classId, selectedSpells: [] });
}

export function setWorkshopSelectedSpells(build, spellIds = []) {
  return createWorkshopBuild({ ...build, selectedSpells: spellIds });
}

export function setWorkshopSlotLocked(build, slotKey, locked = true) {
  const key = String(slotKey);
  if (!workshopSlot(key) || !build?.equipmentBySlot?.[key]) return build;
  const next = new Set(build?.lockedSlots || []);
  if (locked) next.add(key);
  else next.delete(key);
  return createWorkshopBuild({ ...build, lockedSlots: [...next] });
}

export function rejectWorkshopItem(build, slotKey) {
  const key = String(slotKey);
  const item = build?.equipmentBySlot?.[key];
  if (!workshopSlot(key) || !item?.id) return build;
  const equipmentBySlot = cloneEquipment(build?.equipmentBySlot);
  delete equipmentBySlot[key];
  const lockedSlots = (build?.lockedSlots || []).filter((entry) => entry !== key);
  return createWorkshopBuild({
    ...build,
    equipmentBySlot,
    lockedSlots,
    rejectedItemIds: [...(build?.rejectedItemIds || []), String(item.id)]
  });
}

export function clearWorkshopRejectedItems(build) {
  return createWorkshopBuild({ ...build, rejectedItemIds: [] });
}

export function equipWorkshopItem(build, slotKey, item) {
  const descriptor = workshopSlot(slotKey);
  if (!descriptor || !item || item.slot !== descriptor.slot) {
    return { accepted: false, reason: 'slot-mismatch', build };
  }

  const equipmentBySlot = cloneEquipment(build?.equipmentBySlot);
  equipmentBySlot[descriptor.key] = item;
  const next = createWorkshopBuild({ ...build, equipmentBySlot });
  if (!specialSlotRulesAreValid(workshopItems(next))) {
    return { accepted: false, reason: 'special-slot-rule', build };
  }
  return { accepted: true, reason: null, build: next };
}

export function removeWorkshopItem(build, slotKey) {
  if (!workshopSlot(slotKey)) return build;
  const key = String(slotKey);
  const equipmentBySlot = cloneEquipment(build?.equipmentBySlot);
  delete equipmentBySlot[key];
  const lockedSlots = (build?.lockedSlots || []).filter((entry) => entry !== key);
  return createWorkshopBuild({ ...build, equipmentBySlot, lockedSlots });
}
