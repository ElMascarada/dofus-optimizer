import { specialSlotRulesAreValid } from './build-legality.js';
import { buildSuffixCaps, dynamicProfiles } from './constraint-completeness-combat-helpers.js';

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
  debugHints = null
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

  function visitGroup(groupIndex) {
    if (groupIndex >= orderedGroups.length) {
      evaluateLeaf();
      return;
    }
    const group = orderedGroups[groupIndex];
    const profiles = dynamicProfiles(group, selectedItems, setsById, policy, constraints, debugHints);
    const suffix = buildSuffixCaps(profiles, suffixKeys, group.missing);

    function choose(startIndex, picksLeft) {
      if (picksLeft === 0) {
        visitGroup(groupIndex + 1);
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
        selectedItems.push(item);
        selectedIds.add(id);
        let keep = true;
        if (!specialSlotRulesAreValid(selectedItems)) {
          onPrune('special-slot-rule');
          keep = false;
        }
        const left = picksLeft - 1;
        if (keep) keep = safelyPossible(remainingGroups(groupIndex, left, profiles, suffix, index + 1));
        if (keep) choose(index + 1, left);
        selectedIds.delete(id);
        selectedItems.pop();
        onProgressNode(nodes);
      }
    }

    choose(0, group.missing);
  }

  visitGroup(0);
}
