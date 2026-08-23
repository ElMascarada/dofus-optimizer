import { BASE_CHARACTER, SLOT_RULES } from './config.js';
import { addStats, emptyStats, meetsConstraints, stat } from './stats.js';
import { applySetBonuses } from './sets.js';
import { estimateElementValues } from './spells.js';
import { optimizeCharacteristics } from './characteristics.js';
import { optimizeFm } from './fm.js';

function combinations(items, count, start = 0, chosen = [], out = []) {
  if (chosen.length === count) {
    out.push([...chosen]);
    return out;
  }
  for (let i = start; i < items.length; i++) {
    chosen.push(items[i]);
    combinations(items, count, i + 1, chosen, out);
    chosen.pop();
  }
  return out;
}

function buildGroups(items, slotRules = SLOT_RULES) {
  return slotRules.map((rule) => {
    const candidates = items.filter((item) => item.slot === rule.id);
    return {
      ...rule,
      choices: rule.count === 1 ? candidates.map((item) => [item]) : combinations(candidates, rule.count)
    };
  }).filter((group) => group.choices.length > 0);
}

function optimisticConstraintCaps(groups) {
  const keys = ['ap', 'mp', 'range', 'vit', 'resEarth', 'resFire', 'resWater', 'resAir'];
  const suffix = new Array(groups.length + 1).fill(null).map(() => ({}));
  for (let i = groups.length - 1; i >= 0; i--) {
    for (const key of keys) {
      const bestChoice = Math.max(0, ...groups[i].choices.map((choice) => choice.reduce((sum, item) => sum + stat(item.stats, key), 0)));
      suffix[i][key] = (suffix[i + 1][key] || 0) + bestChoice;
    }
  }
  return suffix;
}

function canStillMeetConstraints(stats, constraints, optimistic) {
  for (const [key, minimum] of Object.entries(constraints)) {
    if (!Number.isFinite(minimum) || minimum <= 0) continue;
    // Vitality may still be supplied by characteristic points, so don't prune it here.
    if (key === 'vit') continue;
    if (stat(stats, key) + Number(optimistic[key] || 0) < minimum) return false;
  }
  return true;
}

function insertTop(results, result, limit) {
  results.push(result);
  results.sort((a, b) => b.score - a.score);
  if (results.length > limit) results.length = limit;
}

export function optimizeBuild({
  items,
  sets = [],
  selections,
  constraints,
  fmPolicy,
  turnMode = 'sum',
  topN = 10,
  slotRules = SLOT_RULES,
  character = BASE_CHARACTER,
  onProgress = null
}) {
  const groups = buildGroups(items, slotRules);
  const setsById = Object.fromEntries(sets.map((set) => [set.id, set]));
  const optimistic = optimisticConstraintCaps(groups);
  const results = [];
  let visited = 0;
  let pruned = 0;

  const elementValues = estimateElementValues(selections, {});

  function visit(groupIndex, selectedItems, rawStats) {
    if (!canStillMeetConstraints(rawStats, constraints, optimistic[groupIndex])) {
      pruned++;
      return;
    }

    if (groupIndex === groups.length) {
      visited++;
      const statsWithSets = { ...rawStats };
      const activeSets = applySetBonuses(statsWithSets, selectedItems, setsById);

      const charResult = optimizeCharacteristics(statsWithSets, {
        points: character.characteristicPoints,
        scrolled: character.scrolled,
        elementValues,
        minimumVitality: constraints.vit || 0,
        baseVitality: 0
      });

      if (!meetsConstraints(charResult.stats, constraints)) return;

      const fm = optimizeFm({
        baseStats: charResult.stats,
        items: selectedItems,
        selections,
        turnMode,
        policy: fmPolicy
      });

      if (!meetsConstraints(fm.stats, constraints)) return;

      insertTop(results, {
        score: fm.objective.score,
        perTurn: fm.objective.perTurn,
        items: [...selectedItems],
        stats: fm.stats,
        characteristics: charResult.allocation,
        fm: { critItems: fm.critItems, spellPctItems: fm.spellPctItems, assignments: fm.assignments },
        activeSets
      }, topN);

      if (onProgress && visited % 1000 === 0) onProgress({ visited, pruned, best: results[0]?.score || 0 });
      return;
    }

    const group = groups[groupIndex];
    for (const choice of group.choices) {
      const ids = new Set(selectedItems.map((item) => item.id));
      if (choice.some((item) => ids.has(item.id))) continue;
      const nextStats = { ...rawStats };
      for (const item of choice) addStats(nextStats, item.stats);
      visit(groupIndex + 1, [...selectedItems, ...choice], nextStats);
    }
  }

  const initialStats = emptyStats();
  addStats(initialStats, character.baseStats || {});
  visit(0, [], initialStats);
  return { results, diagnostics: { visited, pruned, groups: groups.map((g) => ({ id: g.id, choices: g.choices.length })) } };
}
