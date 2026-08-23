import { FM_ELIGIBLE_SLOTS } from './fm.js';
import { isPrysmaradite } from './build-legality.js';
import { passiveUpperStats } from './search-space.js';
import { addStats, emptyStats, stat } from './stats.js';

function stableJson(value) {
  return value == null ? '' : JSON.stringify(value);
}

function itemStructureToken(item = {}) {
  return JSON.stringify({
    setId: item.setId || null,
    conditions: item.conditions || null,
    passives: item.passives || [],
    turnBonuses: item.turnBonuses || null,
    prysmaradite: isPrysmaradite(item),
    slotSubtype: item.slotSubtype || null,
    fmClass: FM_ELIGIBLE_SLOTS.has(item.slot)
      ? (stat(item.stats, 'critDamage') === 0 ? 'crit-eligible' : 'spell-only')
      : null
  });
}

function relevantStats(source = {}, keys = []) {
  const result = emptyStats();
  for (const key of keys) {
    const value = Number(source?.[key] || 0);
    if (Number.isFinite(value) && value !== 0) result[key] = value;
  }
  return result;
}

export function choiceForItem(item, keys) {
  const passive = passiveUpperStats(item);
  const stats = relevantStats(item.stats, keys);
  const passiveUpper = relevantStats(passive.stats, keys);
  const objectiveStats = { ...stats };
  addStats(objectiveStats, passiveUpper);
  const setCounts = {};
  if (item.setId) setCounts[item.setId] = 1;
  return {
    items: [item],
    stats,
    passiveUpper,
    objectiveStats,
    bounded: passive.bounded,
    setCounts,
    prysmaCount: isPrysmaradite(item) ? 1 : 0
  };
}

function emptyChoice() {
  return {
    items: [],
    stats: emptyStats(),
    passiveUpper: emptyStats(),
    objectiveStats: emptyStats(),
    bounded: true,
    setCounts: {},
    prysmaCount: 0
  };
}

function combineChoices(a, b) {
  const stats = { ...a.stats };
  const passiveUpper = { ...a.passiveUpper };
  const objectiveStats = { ...a.objectiveStats };
  addStats(stats, b.stats);
  addStats(passiveUpper, b.passiveUpper);
  addStats(objectiveStats, b.objectiveStats);
  const setCounts = { ...a.setCounts };
  for (const [setId, count] of Object.entries(b.setCounts || {})) {
    setCounts[setId] = (setCounts[setId] || 0) + count;
  }
  return {
    items: [...a.items, ...b.items],
    stats,
    passiveUpper,
    objectiveStats,
    bounded: a.bounded && b.bounded,
    setCounts,
    prysmaCount: a.prysmaCount + b.prysmaCount
  };
}

function compareVectors(a, b, keys) {
  let aStrict = false;
  let bStrict = false;
  for (const key of keys) {
    const av = stat(a, key);
    const bv = stat(b, key);
    if (av > bv) aStrict = true;
    else if (bv > av) bStrict = true;
    if (aStrict && bStrict) return 0;
  }
  if (!aStrict && !bStrict) return 2;
  if (aStrict) return 1;
  return -1;
}

function varyingKeysForItems(items, keys) {
  const varying = [];
  for (const key of keys) {
    let first;
    let initialized = false;
    let differs = false;
    for (const item of items) {
      const value = stat(item.stats, key);
      if (!initialized) {
        first = value;
        initialized = true;
      } else if (value !== first) {
        differs = true;
        break;
      }
    }
    if (differs) varying.push(key);
  }
  return varying;
}

function pivotForItems(items, keys) {
  let best = null;
  let bestDistinct = -1;
  let bestRange = -1;
  for (const key of keys) {
    const values = items.map((item) => stat(item.stats, key));
    const distinct = new Set(values).size;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min;
    if (distinct > bestDistinct || (distinct === bestDistinct && range > bestRange)) {
      best = key;
      bestDistinct = distinct;
      bestRange = range;
    }
  }
  return best;
}

function firstAtMost(frontier, pivotKey, value) {
  let lo = 0;
  let hi = frontier.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (stat(frontier[mid].stats, pivotKey) > value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function firstBelow(frontier, pivotKey, value) {
  let lo = 0;
  let hi = frontier.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (stat(frontier[mid].stats, pivotKey) >= value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function insertPareto(frontier, choice, keys, pivotKey, diagnostics) {
  if (!frontier.length) {
    frontier.push(choice);
    return true;
  }
  if (!keys.length) {
    diagnostics.equivalentRemoved++;
    return false;
  }

  const pivot = pivotKey || keys[0];
  const value = stat(choice.stats, pivot);
  const equalStart = firstAtMost(frontier, pivot, value);
  const lowerStart = firstBelow(frontier, pivot, value);

  // States with a strictly larger pivot (plus equal-pivot states) are the only
  // states that can dominate the incoming state. Most weak states die here.
  for (let index = 0; index < lowerStart; index++) {
    const relation = compareVectors(frontier[index].stats, choice.stats, keys);
    if (relation === 1) {
      diagnostics.dominatedRemoved++;
      return false;
    }
    if (relation === 2) {
      diagnostics.equivalentRemoved++;
      return false;
    }
  }

  // Only equal/lower-pivot states can be dominated by the incoming state.
  const remove = [];
  for (let index = equalStart; index < frontier.length; index++) {
    if (compareVectors(choice.stats, frontier[index].stats, keys) === 1) remove.push(index);
  }
  for (let index = remove.length - 1; index >= 0; index--) {
    frontier.splice(remove[index], 1);
    diagnostics.dominatedRemoved++;
  }

  const insertion = firstAtMost(frontier, pivot, value);
  frontier.splice(insertion, 0, choice);
  return true;
}

function partitionCandidates(candidates = []) {
  const partitions = new Map();
  for (const item of candidates) {
    const token = itemStructureToken(item);
    if (!partitions.has(token)) partitions.set(token, []);
    partitions.get(token).push(item);
  }
  return [...partitions.entries()];
}

function buildPartitionFrontiers(items, maxPick, keys, diagnostics, shouldAbort, profile) {
  const activeKeys = varyingKeysForItems(items, keys);
  const pivotKey = pivotForItems(items, activeKeys);
  profile.activeKeys = activeKeys;
  profile.pivotKey = pivotKey;
  const frontiers = Array.from({ length: maxPick + 1 }, () => []);
  frontiers[0].push(emptyChoice());
  let generated = 0;

  for (const item of items) {
    const single = choiceForItem(item, keys);
    for (let pick = maxPick; pick >= 1; pick--) {
      const source = frontiers[pick - 1];
      if (!source.length) continue;
      const snapshot = source.slice();
      for (const state of snapshot) {
        generated++;
        diagnostics.generated++;
        if ((generated & 1023) === 0 && shouldAbort?.()) {
          diagnostics.aborted = true;
          profile.frontierSizes = frontiers.map((frontier) => frontier.length);
          profile.generated = generated;
          return frontiers;
        }
        const next = combineChoices(state, single);
        if (next.prysmaCount > 1) continue;
        insertPareto(frontiers[pick], next, activeKeys, pivotKey, diagnostics);
      }
    }
  }
  profile.frontierSizes = frontiers.map((frontier) => frontier.length);
  profile.generated = generated;
  return frontiers;
}

function pivotForChoices(choices, keys) {
  let best = null;
  let bestDistinct = -1;
  for (const key of keys) {
    const distinct = new Set(choices.map((choice) => stat(choice.stats, key))).size;
    if (distinct > bestDistinct) {
      best = key;
      bestDistinct = distinct;
    }
  }
  return best;
}

export function buildParetoChoices(candidates = [], count = 1, keys = [], { shouldAbort = null } = {}) {
  const diagnostics = {
    partitions: 0,
    generated: 0,
    dominatedRemoved: 0,
    equivalentRemoved: 0,
    partitionProfiles: [],
    aborted: false
  };
  if (count <= 0) return { choices: [emptyChoice()], diagnostics };
  if (candidates.length < count) return { choices: [], diagnostics };
  if (count === 1) {
    return {
      choices: candidates.map((item) => choiceForItem(item, keys)),
      diagnostics: { ...diagnostics, partitions: candidates.length, generated: candidates.length }
    };
  }

  const partitions = partitionCandidates(candidates);
  diagnostics.partitions = partitions.length;
  let global = Array.from({ length: count + 1 }, () => new Map());
  global[0].set('', [emptyChoice()]);

  for (let partitionIndex = 0; partitionIndex < partitions.length; partitionIndex++) {
    const [token, items] = partitions[partitionIndex];
    const tokenObject = JSON.parse(token);
    const partitionLimit = Math.min(count, items.length, tokenObject.prysmaradite ? 1 : count);
    const profile = { size: items.length, limit: partitionLimit, activeKeys: [], pivotKey: null, frontierSizes: [], generated: 0 };
    diagnostics.partitionProfiles.push(profile);
    const local = buildPartitionFrontiers(items, partitionLimit, keys, diagnostics, shouldAbort, profile);
    if (diagnostics.aborted) return { choices: [], diagnostics };

    const nextGlobal = Array.from({ length: count + 1 }, () => new Map());
    for (let total = 0; total <= count; total++) {
      for (const [signature, states] of global[total]) {
        for (let localPick = 0; localPick <= partitionLimit && total + localPick <= count; localPick++) {
          const localStates = local[localPick];
          if (!localStates?.length) continue;
          const nextSignature = `${signature}|${localPick}`;
          let frontier = nextGlobal[total + localPick].get(nextSignature);
          if (!frontier) {
            frontier = [];
            nextGlobal[total + localPick].set(nextSignature, frontier);
          }
          const pivot = pivotForChoices([...states, ...localStates], keys) || keys[0];
          if (frontier.length && pivot) frontier.sort((a, b) => stat(b.stats, pivot) - stat(a.stats, pivot));
          for (const state of states) {
            for (const localState of localStates) {
              diagnostics.generated++;
              if ((diagnostics.generated & 1023) === 0 && shouldAbort?.()) {
                diagnostics.aborted = true;
                return { choices: [], diagnostics };
              }
              const combined = combineChoices(state, localState);
              if (combined.prysmaCount > 1) continue;
              insertPareto(frontier, combined, keys, pivot, diagnostics);
            }
          }
        }
      }
    }
    global = nextGlobal;
  }

  const choices = [];
  for (const frontier of global[count].values()) choices.push(...frontier);
  return { choices, diagnostics };
}

export function choiceStructureTokenForTest(item) {
  return stableJson(JSON.parse(itemStructureToken(item)));
}
