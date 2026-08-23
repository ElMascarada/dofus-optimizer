import { addStats, emptyStats, stat } from './stats.js';
import { applySetBonuses } from './sets.js';
import { evaluateObjectiveUpperBound } from './spells.js';
import { specialSlotRulesAreValid } from './build-legality.js';
import { coreOffensiveDofus, dofusSeedPrior } from './dofus-seed-priors.js';

function itemId(item) {
  return String(item?.id ?? '');
}

function choiceSignature(choice) {
  return (choice?.items || []).map(itemId).sort().join(',');
}

function stateSignature(items = []) {
  return items.map(itemId).sort().join('|');
}

function statsForItems(baseStats = {}, items = [], setsById = {}) {
  const stats = emptyStats();
  addStats(stats, baseStats || {});
  for (const item of items) addStats(stats, item?.stats || {});
  applySetBonuses(stats, items, setsById);
  return stats;
}

function constraintFitness(stats, constraints = {}) {
  let coverage = 0;
  let missing = 0;
  let active = 0;
  for (const [key, minimumRaw] of Object.entries(constraints || {})) {
    const minimum = Number(minimumRaw);
    if (!(minimum > 0)) continue;
    active++;
    const value = Math.max(0, stat(stats, key));
    const ratio = value / minimum;
    coverage += Math.min(1, ratio);
    missing += Math.max(0, 1 - ratio);
  }
  return { coverage, missing, active };
}

function directionalFitness(items = [], classifications = new Map()) {
  let score = 0;
  for (const item of items) {
    const priority = Math.max(0, Number(classifications?.get(item.id)?.priority || 0));
    score += Math.log1p(priority);
  }
  return score;
}

function dofusPriorFitness(items = []) {
  return items.reduce((sum, item) => sum + dofusSeedPrior(item), 0);
}

function rankState(items, {
  baseStats,
  setsById,
  constraints,
  selections,
  turnMode,
  classifications
}) {
  const stats = statsForItems(baseStats, items, setsById);
  const constraint = constraintFitness(stats, constraints);
  const objective = Number(evaluateObjectiveUpperBound({ stats, selections, turnMode }).score || 0);
  const directional = directionalFitness(items, classifications);
  const dofusPrior = dofusPriorFitness(items);

  const feasibility = constraint.active
    ? (constraint.coverage * 1e9 - constraint.missing * 1e8)
    : 0;

  // The Dofus prior is deliberately strong only inside the heuristic seed. It helps
  // test familiar offensive cores early, but never forces them into the exact result.
  return feasibility + dofusPrior * 1e6 + objective * 1000 + directional * 100;
}

function pushUnique(map, key, value) {
  if (!map.has(key)) map.set(key, value);
}

function shortlistStaticChoices(group, constraints, classifications, {
  baseLimit = 16,
  perConstraint = 4,
  roleLimit = 8
} = {}) {
  const choices = group?.choices || [];
  if (choices.length <= baseLimit) return choices;
  const selected = new Map();
  for (const choice of choices.slice(0, baseLimit)) pushUnique(selected, choiceSignature(choice), choice);

  for (const [key, minimumRaw] of Object.entries(constraints || {})) {
    if (!(Number(minimumRaw) > 0)) continue;
    const ranked = choices
      .map((choice) => ({ choice, value: (choice.items || []).reduce((sum, item) => sum + Math.max(0, stat(item?.stats, key)), 0) }))
      .filter((entry) => entry.value > 0)
      .sort((a, b) => b.value - a.value);
    for (const { choice } of ranked.slice(0, perConstraint)) pushUnique(selected, choiceSignature(choice), choice);
  }

  const roleChoices = choices
    .map((choice) => ({
      choice,
      priority: (choice.items || []).reduce((sum, item) => {
        const role = classifications?.get(item.id)?.role;
        if (role !== 'set-enabler' && role !== 'resource' && role !== 'prerequisite') return sum;
        return sum + Math.max(0, Number(classifications.get(item.id)?.priority || 0));
      }, 0)
    }))
    .filter((entry) => entry.priority > 0)
    .sort((a, b) => b.priority - a.priority);
  for (const { choice } of roleChoices.slice(0, roleLimit)) pushUnique(selected, choiceSignature(choice), choice);

  return [...selected.values()];
}

function shortlistDynamicCandidates(group, constraints, classifications, {
  baseLimit = 28,
  perConstraint = 6,
  offensiveLimit = 24,
  supportLimit = 12
} = {}) {
  const candidates = group?.candidates || [];
  if (candidates.length <= baseLimit) return candidates;
  const selected = new Map();
  for (const item of candidates.slice(0, baseLimit)) pushUnique(selected, itemId(item), item);

  // Always preserve known high-value offensive/flexible Dofus in the heuristic pool.
  // This is only an ordering hint; final correctness is still owned by exact search.
  for (const item of candidates.filter((candidate) => dofusSeedPrior(candidate) > 0)) {
    pushUnique(selected, itemId(item), item);
  }

  for (const [key, minimumRaw] of Object.entries(constraints || {})) {
    if (!(Number(minimumRaw) > 0)) continue;
    const ranked = candidates
      .map((item) => ({ item, value: Math.max(0, stat(item?.stats, key)) }))
      .filter((entry) => entry.value > 0)
      .sort((a, b) => b.value - a.value);
    for (const { item } of ranked.slice(0, perConstraint)) pushUnique(selected, itemId(item), item);
  }

  const offensive = candidates
    .filter((item) => classifications?.get(item.id)?.role === 'offensive')
    .sort((a, b) => Number(classifications?.get(b.id)?.priority || 0) - Number(classifications?.get(a.id)?.priority || 0));
  for (const item of offensive.slice(0, offensiveLimit)) pushUnique(selected, itemId(item), item);

  const support = candidates
    .filter((item) => ['resource', 'constraint', 'prerequisite', 'set-enabler'].includes(classifications?.get(item.id)?.role))
    .sort((a, b) => Number(classifications?.get(b.id)?.priority || 0) - Number(classifications?.get(a.id)?.priority || 0));
  for (const item of support.slice(0, supportLimit)) pushUnique(selected, itemId(item), item);

  return [...selected.values()];
}

function trimBeam(states, width) {
  const bestBySignature = new Map();
  for (const state of states) {
    const key = stateSignature(state.items);
    const previous = bestBySignature.get(key);
    if (!previous || state.rank > previous.rank) bestBySignature.set(key, state);
  }
  return [...bestBySignature.values()]
    .sort((a, b) => b.rank - a.rank)
    .slice(0, width);
}

function insertSeedResult(results, result, limit) {
  if (!result) return;
  const signature = stateSignature(result.items || []);
  if (results.some((entry) => stateSignature(entry.items || []) === signature)) return;
  results.push(result);
  results.sort((a, b) => b.score - a.score);
  if (results.length > limit) results.length = limit;
}

function expandWithHardChoices(beam, group, rankOptions, dynamicBaseWidth, dynamicBeamWidth) {
  const expanded = [];
  const bases = beam.slice(0, dynamicBaseWidth);
  for (const state of bases) {
    const selectedIds = new Set(state.items.map((item) => item.id));
    for (const choice of group.hardConstraintChoices || []) {
      if ((choice.items || []).some((item) => selectedIds.has(item.id))) continue;
      const items = [...state.items, ...(choice.items || [])];
      if (!specialSlotRulesAreValid(items)) continue;
      expanded.push({ items, rank: rankState(items, rankOptions) });
    }
  }
  return {
    beam: trimBeam(expanded, dynamicBeamWidth),
    generated: expanded.length
  };
}

function expandWithDynamicCandidates(beam, group, candidates, rankOptions, dynamicBaseWidth, dynamicBeamWidth) {
  let dynamicBeam = beam.slice(0, dynamicBaseWidth).map((state) => ({ ...state, lastIndex: -1 }));
  let generated = 0;
  for (let pick = 0; pick < Number(group.count || 0); pick++) {
    const expanded = [];
    const remainingAfter = Number(group.count || 0) - pick - 1;
    for (const state of dynamicBeam) {
      const selectedIds = new Set(state.items.map((item) => item.id));
      const maxIndex = candidates.length - remainingAfter;
      for (let index = state.lastIndex + 1; index < maxIndex; index++) {
        const item = candidates[index];
        if (selectedIds.has(item.id)) continue;
        const items = [...state.items, item];
        if (!specialSlotRulesAreValid(items)) continue;
        generated++;
        expanded.push({ items, lastIndex: index, rank: rankState(items, rankOptions) });
      }
    }
    dynamicBeam = trimBeam(expanded, dynamicBeamWidth).map((state) => ({ ...state, lastIndex: state.lastIndex ?? -1 }));
    if (!dynamicBeam.length) break;
  }
  return {
    beam: dynamicBeam.map(({ lastIndex, ...state }) => state),
    generated
  };
}

export function findSeedResults({
  groups = [],
  baseStats = {},
  setsById = {},
  constraints = {},
  selections = [],
  turnMode = 'sum',
  classifications = new Map(),
  evaluateComplete,
  resultLimit = 1,
  beamWidth = 160,
  dynamicBeamWidth = 512,
  dynamicBaseWidth = 40,
  evaluateLimit = 512
} = {}) {
  const started = typeof performance !== 'undefined' ? performance.now() : Date.now();
  let generated = 0;
  let beam = [{ items: [], rank: 0 }];
  const dynamicGroups = [];

  const rankOptions = { baseStats, setsById, constraints, selections, turnMode, classifications };

  for (const group of groups) {
    if (group.dynamic) {
      dynamicGroups.push(group);
      continue;
    }
    const shortlist = shortlistStaticChoices(group, constraints, classifications);
    const expanded = [];
    for (const state of beam) {
      const selectedIds = new Set(state.items.map((item) => item.id));
      for (const choice of shortlist) {
        if ((choice.items || []).some((item) => selectedIds.has(item.id))) continue;
        const items = [...state.items, ...(choice.items || [])];
        if (!specialSlotRulesAreValid(items)) continue;
        generated++;
        expanded.push({ items, rank: rankState(items, rankOptions) });
      }
    }
    beam = trimBeam(expanded, beamWidth);
    if (!beam.length) break;
  }

  for (const group of dynamicGroups) {
    const channels = [];

    if (group.hardConstraintChoices?.length) {
      const hard = expandWithHardChoices(beam, group, rankOptions, dynamicBaseWidth, dynamicBeamWidth);
      generated += hard.generated;
      channels.push(...hard.beam);
    }

    const candidates = shortlistDynamicCandidates(group, constraints, classifications);
    const offensive = expandWithDynamicCandidates(
      beam,
      group,
      candidates,
      rankOptions,
      dynamicBaseWidth,
      dynamicBeamWidth
    );
    generated += offensive.generated;
    channels.push(...offensive.beam);

    beam = trimBeam(channels, dynamicBeamWidth);
  }

  const results = [];
  let evaluated = 0;
  for (const state of beam.slice(0, evaluateLimit)) {
    evaluated++;
    insertSeedResult(results, evaluateComplete?.(state.items), resultLimit);
    if (results.length >= resultLimit && evaluated >= Math.min(evaluateLimit, resultLimit * 8)) break;
  }

  const finished = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return {
    results,
    diagnostics: {
      generated,
      evaluated,
      finalBeam: beam.length,
      found: results.length,
      elapsedMs: Math.max(0, Math.round(finished - started)),
      dynamicGroups: dynamicGroups.map((group) => ({
        id: group.id,
        count: group.count,
        candidates: group.candidates?.length || 0,
        hardConstraintChoices: group.hardConstraintChoices?.length || 0,
        coreCandidates: coreOffensiveDofus(group.candidates || []).length,
        shortlisted: shortlistDynamicCandidates(group, constraints, classifications).length
      }))
    }
  };
}
