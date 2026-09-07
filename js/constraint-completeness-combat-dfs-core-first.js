import { specialSlotRulesAreValid } from './build-legality.js';
import { buildSuffixCaps, dynamicProfiles } from './constraint-completeness-combat-helpers.js';
import { dynamicProfilesContextual } from './constraint-completeness-dynamic-guidance.js';

const EQUIPMENT_SLOTS = new Set(['hat', 'cape', 'amulet', 'belt', 'boots', 'weapon', 'ring', 'shield']);

export function runSetCoreFirstCombatGroupDfs({
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
  onGroupExpansion = null,
  coreSeeds = [],
  onLaneStart = null,
  contextualDofusGuidance = true
}) {
  const groupById = new Map(orderedGroups.map((group, index) => [group.id, { group, index }]));

  function seedCountsFor(seed) {
    const additions = [];
    const counts = new Map();
    for (const item of seed?.items || []) {
      const id = String(item.id);
      if (selectedIds.has(id)) continue;
      if (!EQUIPMENT_SLOTS.has(item.slot)) return null;
      const located = groupById.get(item.slot);
      if (!located) return null;
      if (!(located.group.profiles || []).some((profile) => String(profile.item.id) === id)) return null;
      counts.set(item.slot, Number(counts.get(item.slot) || 0) + 1);
      if (counts.get(item.slot) > Number(located.group.missing || 0)) return null;
      additions.push(item);
    }
    return { additions, counts };
  }

  function runLane(seed = null) {
    const seeded = seed ? seedCountsFor(seed) : { additions: [], counts: new Map() };
    if (!seeded) return false;
    const addedIds = [];
    const seedNode = seed ? onNode() : null;
    for (const item of seeded.additions) {
      selectedItems.push(item);
      selectedIds.add(String(item.id));
      addedIds.push(String(item.id));
    }
    if (!specialSlotRulesAreValid(selectedItems)) {
      for (let index = addedIds.length - 1; index >= 0; index--) {
        selectedIds.delete(addedIds[index]);
        selectedItems.pop();
      }
      onPrune('special-slot-rule');
      return false;
    }

    const laneMissing = (group) => Math.max(0, Number(group.missing || 0) - Number(seeded.counts.get(group.id) || 0));
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
        const group = orderedGroups[index];
        const missing = laneMissing(group);
        if (missing <= 0) continue;
        const available = (group.profiles || []).filter((profile) => !selectedIds.has(String(profile.item.id)));
        remaining.push({
          id: group.id,
          missing,
          profileCaps: buildSuffixCaps(available, suffixKeys, missing).get(0, missing),
          availableProfiles: available
        });
      }
      return remaining;
    }
    function fullRemainingFrom(groupIndex) {
      const remaining = [];
      for (let index = groupIndex; index < orderedGroups.length; index++) {
        const group = orderedGroups[index];
        const missing = laneMissing(group);
        if (missing <= 0) continue;
        const available = (group.profiles || []).filter((profile) => !selectedIds.has(String(profile.item.id)));
        remaining.push({
          id: group.id,
          missing,
          profileCaps: buildSuffixCaps(available, suffixKeys, missing).get(0, missing),
          availableProfiles: available
        });
      }
      return remaining;
    }

    const firstNonEquipmentIndex = orderedGroups.findIndex((group) => !EQUIPMENT_SLOTS.has(group.id));
    const equipmentBoundaryIndex = firstNonEquipmentIndex < 0 ? orderedGroups.length : firstNonEquipmentIndex;

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
      const missing = laneMissing(group);
      if (missing <= 0) {
        visitGroup(groupIndex + 1, boundaryIndex);
        return;
      }
      const unselectedProfiles = (group.profiles || []).filter((profile) => !selectedIds.has(String(profile.item.id)));
      const dynamicGroup = { ...group, missing, profiles: unselectedProfiles };
      const profiles = contextualDofusGuidance
        ? dynamicProfilesContextual(dynamicGroup, selectedItems, setsById, policy, constraints, debugHints)
        : dynamicProfiles(dynamicGroup, selectedItems, setsById, policy, constraints, debugHints);
      const suffix = buildSuffixCaps(profiles, suffixKeys, missing);

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

      choose(0, missing);
    }

    if (onLaneStart) onLaneStart({ seed, standalone: !seed });
    const initialRemaining = fullRemainingFrom(0);
    if (safelyPossible(initialRemaining)) {
      if (equipmentPareto) visitGroup(0, equipmentBoundaryIndex);
      else visitGroup(0);
    }

    for (let index = addedIds.length - 1; index >= 0; index--) {
      selectedIds.delete(addedIds[index]);
      selectedItems.pop();
    }
    if (seedNode !== null) onProgressNode(seedNode);
    return true;
  }

  for (const seed of coreSeeds || []) runLane(seed);
  runLane(null);
}
