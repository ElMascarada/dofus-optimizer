import {
  WORKSHOP_SLOTS,
  workshopBuildIsComplete,
  workshopItems,
  workshopLockedItemsBySlot
} from './workshop-build.js';

function workshopEquippedItemsBySlot(build = {}) {
  return Object.fromEntries(WORKSHOP_SLOTS
    .filter(({ key }) => build?.equipmentBySlot?.[key]?.id != null)
    .map(({ key }) => [key, String(build.equipmentBySlot[key].id)]));
}

export function workshopOptimizationContext(build = {}) {
  const complete = workshopBuildIsComplete(build);
  const lockedItemsBySlot = workshopLockedItemsBySlot(build);
  const searchRequiredItemsBySlot = complete
    ? lockedItemsBySlot
    : workshopEquippedItemsBySlot(build);
  const rejectedItemIds = [...new Set((build?.rejectedItemIds || []).map(String).filter(Boolean))].sort();
  const seedBuild = complete
    ? {
        itemIds: workshopItems(build).map((item) => String(item.id)),
        sourceFingerprint: 'workshop-current',
        sourceDistance: 0,
        sourceScore: 0
      }
    : null;

  return Object.freeze({
    classId: build?.classId ? String(build.classId) : null,
    mode: complete ? 'improve-complete' : 'fill-missing',
    lockedItemsBySlot: Object.freeze({ ...lockedItemsBySlot }),
    searchRequiredItemsBySlot: Object.freeze({ ...searchRequiredItemsBySlot }),
    rejectedItemIds: Object.freeze(rejectedItemIds),
    seedBuild: seedBuild ? Object.freeze({ ...seedBuild, itemIds: Object.freeze([...seedBuild.itemIds]) }) : null
  });
}
