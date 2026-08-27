import {
  WORKSHOP_FM_POLICY,
  createWorkshopBuild,
  equipWorkshopItem,
  workshopSlot
} from './workshop-build.js';

export const WORKSHOP_BUILD_SCHEMA_VERSION = 2;

function cloneFmPolicy(value = {}) {
  return { ...WORKSHOP_FM_POLICY, ...(value || {}) };
}

function canonicalItemId(value) {
  if (value == null) return null;
  if (typeof value === 'object') return value.id == null ? null : String(value.id);
  return String(value);
}

function normalizedStringList(value = []) {
  return [...new Set((value || []).map(String).filter(Boolean))].sort();
}

function canonicalSnapshot(snapshot = {}) {
  return {
    schemaVersion: WORKSHOP_BUILD_SCHEMA_VERSION,
    dataVersion: snapshot.dataVersion || null,
    classId: snapshot.classId ? String(snapshot.classId) : null,
    equipmentBySlot: Object.fromEntries(
      Object.entries(snapshot.equipmentBySlot || {})
        .map(([slotKey, itemId]) => [String(slotKey), canonicalItemId(itemId)])
        .filter(([, itemId]) => Boolean(itemId))
    ),
    fmPolicy: cloneFmPolicy(snapshot.fmPolicy),
    selectedSpells: normalizedStringList(snapshot.selectedSpells),
    lockedSlots: normalizedStringList(snapshot.lockedSlots),
    rejectedItemIds: normalizedStringList(snapshot.rejectedItemIds)
  };
}

export function migrateWorkshopBuildSnapshot(snapshot = {}) {
  const version = Number(snapshot?.schemaVersion || 0);
  if (version > WORKSHOP_BUILD_SCHEMA_VERSION) {
    throw new Error(`Version de build Atelier non prise en charge: ${version}.`);
  }

  if (version >= 1) return canonicalSnapshot(snapshot);

  // Legacy/v0 compatibility: early Atelier drafts could persist runtime item
  // objects directly. Migrate them to canonical IDs before any reconstruction.
  return canonicalSnapshot({
    ...snapshot,
    equipmentBySlot: Object.fromEntries(
      Object.entries(snapshot.equipmentBySlot || {})
        .map(([slotKey, item]) => [String(slotKey), canonicalItemId(item)])
        .filter(([, itemId]) => Boolean(itemId))
    ),
    lockedSlots: [],
    rejectedItemIds: []
  });
}

export function serializeWorkshopBuild(build = {}, { dataVersion = null } = {}) {
  return migrateWorkshopBuildSnapshot({
    schemaVersion: WORKSHOP_BUILD_SCHEMA_VERSION,
    dataVersion,
    classId: build.classId,
    equipmentBySlot: Object.fromEntries(
      Object.entries(build.equipmentBySlot || {})
        .map(([slotKey, item]) => [String(slotKey), canonicalItemId(item)])
        .filter(([, itemId]) => Boolean(itemId))
    ),
    fmPolicy: build.fmPolicy,
    selectedSpells: build.selectedSpells,
    lockedSlots: build.lockedSlots,
    rejectedItemIds: build.rejectedItemIds
  });
}

export function rehydrateWorkshopBuild(snapshot = {}, { items = [] } = {}) {
  const migrated = migrateWorkshopBuildSnapshot(snapshot);
  const byId = new Map((items || []).map((item) => [String(item.id), item]));
  const missingItems = [];
  const incompatibleItems = [];
  let build = createWorkshopBuild({
    classId: migrated.classId,
    fmPolicy: migrated.fmPolicy,
    selectedSpells: migrated.selectedSpells,
    rejectedItemIds: migrated.rejectedItemIds
  });

  for (const [slotKey, itemId] of Object.entries(migrated.equipmentBySlot || {})) {
    const descriptor = workshopSlot(slotKey);
    const item = byId.get(String(itemId));
    if (!descriptor || !item) {
      missingItems.push({ slotKey, itemId: String(itemId) });
      continue;
    }
    if (item.slot !== descriptor.slot) {
      incompatibleItems.push({ slotKey, itemId: String(itemId), reason: 'slot-mismatch' });
      continue;
    }
    const update = equipWorkshopItem(build, slotKey, item);
    if (!update.accepted) {
      incompatibleItems.push({ slotKey, itemId: String(itemId), reason: update.reason });
      continue;
    }
    build = update.build;
  }

  build = createWorkshopBuild({ ...build, lockedSlots: migrated.lockedSlots });

  return {
    build,
    snapshot: migrated,
    missingItems,
    incompatibleItems,
    degraded: missingItems.length > 0 || incompatibleItems.length > 0
  };
}
