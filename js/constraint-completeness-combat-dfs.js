import { specialSlotRulesAreValid } from './build-legality.js';
import { buildSuffixCaps, dynamicProfiles } from './constraint-completeness-combat-helpers.js';

const EQUIPMENT_SLOTS = new Set(['hat', 'cape', 'amulet', 'belt', 'boots', 'weapon', 'ring', 'shield']);

export function runExactCombatGroupDfs({
  orderedGroups,
  selectedItems,
  selectedIds,
  setsById,
  policy,
  constraints,
  suffixKeys,
  safelyPossible,
  evaluateLeaf,
  onNode,
  onPrune,
  onProgressNode,
  debugHints = null,
  equipmentPareto = null,
  onGroupExpansion = null
}) {
  function remainingGroups(groupIndex, picksLeft = 0, profiles = null, suffix = null, nextStart = 0) {
    const remaining = [];
    if (picksLeft > 0) {
      remaining.push({
        id: orderedGroups[groupIndex].id,
        missing: picksLeft,
        profileCaps: suffix.get(nextStart, picksLeft),
        availableProfiles: profiles.slice(nextStart)
      });
    }
    for (let index = groupIndex + 1; index < orderedGroups.length; index++) {
      remaining.push({
        id: orderedGroups[index].id,
        missing: orderedGroups[index].missing,
        profileCaps: orderedGroups[index].fullProfileCaps,
        availableProfiles: orderedGroups[index].profiles
      });
    }
    return remaining;
  }

  function fullRemainingFrom(groupIndex) {
    const remaining = [];
    for (let index = groupIndex; index < orderedGroups.length; index++) {
      remaining.push({
        id: orderedGroups[index].id,
        missing: orderedGroups[index].missing,
        profileCaps: orderedGroups[index].fullProfileCaps,
        availableProfiles: orderedGroups[index].profiles
      });
    }
    return remaining;
  }

  function visitGroup(groupIndex, boundaryIndex = -1) {
    if (boundaryIndex >= 0 && groupIndex === boundaryIndex) {
      const paretoResult = equipmentPareto.consider(selectedItems);
      if (paretoResult?.dominated) return;
      if (!safelyPossible(fullRemainingFrom(groupIndex))) return;
      visitGroup(groupIndex);
      return;
    }
    if (groupIndex >= orderedGroups.length) {
      evaluateLeaf();
      return;
    }
    const group = orderedGroups[groupIndex];
    const profiles = dynamicProfiles(group, selectedItems, setsById, policy, constraints, debugHints);
    const suffix = buildSuffixCaps(profiles, suffixKeys, group.missing);

    function choose(startIndex, picksLeft) {
      if (picksLeft === 0) {
        visitGroup(groupIndex + 1, boundaryIndex);
        return;
      }
      const lastStart = profiles.length - picksLeft;
      if (startIndex > lastStart) {
        onPrune('impossible-build-shape');
        return;
      }
      for (let index = startIndex; index <= lastStart; index++) {
        const item = profiles[index].item;
        const id = String(item.id);
        if (selectedIds.has(id)) continue;
        const nodes = onNode();
        if (onGroupExpansion) onGroupExpansion(group.id);
        selectedItems.push(item);
        selectedIds.add(id);
        let keep = true;
        if (!specialSlotRulesAreValid(selectedItems)) {
          onPrune('special-slot-rule');
          keep = false;
        }
        const left = picksLeft - 1;
        const reachesEquipmentBoundary = boundaryIndex >= 0
          && left === 0
          && groupIndex + 1 === boundaryIndex;
        if (keep && !reachesEquipmentBoundary) {
          keep = safelyPossible(remainingGroups(groupIndex, left, profiles, suffix, index + 1));
        }
        if (keep) choose(index + 1, left);
        selectedIds.delete(id);
        selectedItems.pop();
        onProgressNode(nodes);
      }
    }

    choose(0, group.missing);
  }

  if (!equipmentPareto) {
    visitGroup(0);
    return;
  }

  const firstNonEquipmentIndex = orderedGroups.findIndex((group) => !EQUIPMENT_SLOTS.has(group.id));
  const equipmentBoundaryIndex = firstNonEquipmentIndex < 0 ? orderedGroups.length : firstNonEquipmentIndex;
  visitGroup(0, equipmentBoundaryIndex);
}
