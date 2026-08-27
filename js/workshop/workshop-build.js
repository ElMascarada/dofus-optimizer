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
const SLOT_KEYS_BY_SLOT = new Map();
for (const descriptor of WORKSHOP_SLOTS) {
  if (!SLOT_KEYS_BY_SLOT.has(descriptor.slot)) SLOT_KEYS_BY_SLOT.set(descriptor.slot, []);
  SLOT_KEYS_BY_SLOT.get(descriptor.slot).push(descriptor.key);
}

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

export function createWorkshopBuildFromOptimizerResult({
  result,
  classId = null,
  fmPolicy = WORKSHOP_FM_POLICY
} = {}) {
  const equipmentBySlot = {};
  const usedBySlot = new Map();
  for (const item of result?.items || []) {
    const keys = SLOT_KEYS_BY_SLOT.get(item?.slot) || [];
    const index = usedBySlot.get(item?.slot) || 0;
    if (!keys[index]) throw new Error(`Résultat incompatible avec l’Atelier : slot ${item?.slot || 'inconnu'} en surnombre.`);
    equipmentBySlot[keys[index]] = item;
    usedBySlot.set(item.slot, index + 1);
  }

  const selectedSpells = [...new Set(
    (result?.combatPlan?.sequence || [])
      .map((entry) => entry?.spellId ?? entry?.id)
      .filter(Boolean)
      .map(String)
  )];
  const build = createWorkshopBuild({ classId, equipmentBySlot, fmPolicy, selectedSpells });
  if (!specialSlotRulesAreValid(workshopItems(build))) {
    throw new Error('Résultat incompatible avec les règles de slots de l’Atelier.');
  }
  return build;
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
