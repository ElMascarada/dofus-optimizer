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

function choiceForItem(item, keys) {
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

function insertPareto(frontier, choice, keys, diagnostics) {
  const remove = [];
  for (let index = 0; index < frontier.length; index++) {
    const relation = compareVectors(frontier[index].stats, choice.stats, keys);
    if (relation === 1) {
      diagnostics.dominatedRemoved++;
      return false;
    }
    if (relation === 2) {
      diagnostics.equivalentRemoved++;
      return false;
    }
    if (relation === -1) remove.push(index);
  }
  for (let index = remove.length - 1; index >= 0; index--) {
    frontier.splice(remove[index], 1);
    diagnostics.dominatedRemoved++;
  }
  frontier.push(choice);
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

function buildPartitionFrontiers(items, maxPick, keys, diagnostics, shouldAbort) {
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
        if ((generated & 2047) === 0 && shouldAbort?.()) {
          diagnostics.aborted = true;
          return frontiers;
        }
        const next = combineChoices(state, single);
        if (next.prysmaCount > 1) continue;
        insertPareto(frontiers[pick], next, keys, diagnostics);
      }
    }
  }
  diagnostics.generated += generated;
  return frontiers;
}

export function buildParetoChoices(candidates = [], count = 1, keys = [], { shouldAbort = null } = {}) {
  const diagnostics = {
    partitions: 0,
    generated: 0,
    dominatedRemoved: 0,
    equivalentRemoved: 0,
    aborted: false
  };
  if (count <= 0) return { choices: [emptyChoice()], diagnostics };
  if (candidates.length < count) return { choices: [], diagnostics };

  const partitions = partitionCandidates(candidates);
  diagnostics.partitions = partitions.length;
  let global = Array.from({ length: count + 1 }, () => new Map());
  global[0].set('', [emptyChoice()]);

  for (let partitionIndex = 0; partitionIndex < partitions.length; partitionIndex++) {
    const [token, items] = partitions[partitionIndex];
    const tokenObject = JSON.parse(token);
    const partitionLimit = Math.min(count, items.length, tokenObject.prysmaradite ? 1 : count);
    const local = buildPartitionFrontiers(items, partitionLimit, keys, diagnostics, shouldAbort);
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
          for (const state of states) {
            for (const localState of localStates) {
              diagnostics.generated++;
              if ((diagnostics.generated & 2047) === 0 && shouldAbort?.()) {
                diagnostics.aborted = true;
                return { choices: [], diagnostics };
              }
              const combined = combineChoices(state, localState);
              if (combined.prysmaCount > 1) continue;
              insertPareto(frontier, combined, keys, diagnostics);
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
