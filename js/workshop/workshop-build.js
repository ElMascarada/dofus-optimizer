import { specialSlotRulesAreValid } from '../build-legality.js';

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

function cloneEquipment(equipmentBySlot = {}) {
  return Object.fromEntries(Object.entries(equipmentBySlot).filter(([, item]) => Boolean(item)));
}

export function createWorkshopBuild({
  classId = null,
  equipmentBySlot = {},
  fmPolicy = WORKSHOP_FM_POLICY,
  selectedSpells = []
} = {}) {
  return {
    classId: classId ? String(classId) : null,
    equipmentBySlot: cloneEquipment(equipmentBySlot),
    fmPolicy: { ...WORKSHOP_FM_POLICY, ...(fmPolicy || {}) },
    selectedSpells: [...new Set((selectedSpells || []).map(String))]
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

export function setWorkshopClass(build, classId) {
  return createWorkshopBuild({ ...build, classId, selectedSpells: [] });
}

export function setWorkshopSelectedSpells(build, spellIds = []) {
  return createWorkshopBuild({ ...build, selectedSpells: spellIds });
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
  const equipmentBySlot = cloneEquipment(build?.equipmentBySlot);
  delete equipmentBySlot[String(slotKey)];
  return createWorkshopBuild({ ...build, equipmentBySlot });
}
