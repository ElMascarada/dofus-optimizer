import {
  workshopBuildIsComplete,
  workshopItems,
  workshopLockedItemsBySlot
} from './workshop-build.js';

export function workshopOptimizationContext(build = {}) {
  const lockedItemsBySlot = workshopLockedItemsBySlot(build);
  const rejectedItemIds = [...new Set((build?.rejectedItemIds || []).map(String).filter(Boolean))].sort();
  const seedBuild = workshopBuildIsComplete(build)
    ? {
        itemIds: workshopItems(build).map((item) => String(item.id)),
        sourceFingerprint: 'workshop-current',
        sourceDistance: 0,
        sourceScore: 0
      }
    : null;

  return Object.freeze({
    classId: build?.classId ? String(build.classId) : null,
    lockedItemsBySlot: Object.freeze({ ...lockedItemsBySlot }),
    rejectedItemIds: Object.freeze(rejectedItemIds),
    seedBuild: seedBuild ? Object.freeze({ ...seedBuild, itemIds: Object.freeze([...seedBuild.itemIds]) }) : null
  });
}
