import { SLOT_RULES } from './config.js';
import { prefilterItems, activeSpellElements } from './candidate-prefilter.js';
import { buildSetSynergyIndex } from './set-synergy-index.js';
import { evaluateCompleteBuild } from './complete-build-evaluator.js';
import { evaluateObjectiveUpperBound } from './spells.js';
import { optimisticItemStats } from './search-space.js';
import { isPrysmaradite, specialSlotRulesAreValid } from './build-legality.js';

const ELEMENT_DAMAGE = {
  earth: 'damageEarth',
  fire: 'damageFire',
  water: 'damageWater',
  air: 'damageAir'
};

const GENERIC_OFFENSE = [
  'power', 'damage', 'crit', 'critDamage', 'spellDamagePct',
  'finalDamagePct', 'finalDamagePctT1', 'finalDamagePctT2', 'finalDamagePctT3'
];

const SLOT_CANDIDATE_LIMIT = Object.freeze({
  dofus: 18,
  ring: 14,
  companion: 12,
  weapon: 10,
  hat: 9,
  cape: 9,
  amulet: 9,
  belt: 9,
  boots: 9,
  shield: 9
});

const GROUP_CHOICE_LIMIT = Object.freeze({
  dofus: 32,
  ring: 20,
  companion: 10,
  weapon: 8,
  hat: 8,
  cape: 8,
  amulet: 8,
  belt: 8,
  boots: 8,
  shield: 8
});

function num(stats, key) {
  const value = Number(stats?.[key] || 0);
  return Number.isFinite(value) ? value : 0;
}

function resultKey(result) {
  return (result?.items || []).map((item) => String(item.id)).sort().join('|');
}

function insertTop(results, result, limit) {
  if (!result?.items?.length) return;
  const key = resultKey(result);
  const index = results.findIndex((entry) => resultKey(entry) === key);
  if (index >= 0) {
    if (results[index].score >= result.score) return;
    results.splice(index, 1);
  }
  results.push(result);
  results.sort((a, b) => b.score - a.score);
  if (results.length > limit) results.length = limit;
}

function itemHeuristic(item, context) {
  const stats = optimisticItemStats(item, {
    includePassives: true,
    turnMode: context.turnMode,
    scenario: context.scenario
  }).stats;
  const objective = evaluateObjectiveUpperBound({
    stats,
    selections: context.selections,
    turnMode: context.turnMode
  }).score;

  let score = Number.isFinite(objective) ? objective : 0;
  score += Math.max(0, num(stats, 'ap')) * 52000;
  score += Math.max(0, num(stats, 'mp')) * 34000;
  score += Math.max(0, num(stats, 'range')) * 1200;

  if (context.targetElement) {
    score += Math.max(0, num(stats, context.targetElement)) * 26;
    score += Math.max(0, num(stats, ELEMENT_DAMAGE[context.targetElement])) * 34;
  }
  for (const key of GENERIC_OFFENSE) score += Math.max(0, num(stats, key)) * 6;

  // Once the set skeleton is fixed, strong standalone pieces are exactly what
  // we want to test as replacements (legendary items are naturally included).
  if (!item.setId && item.slot !== 'dofus' && item.slot !== 'companion') score += 1800;
  return score;
}

function choiceKey(items) {
  return items.map((item) => String(item.id)).sort().join('|');
}

function bestGroupChoices(candidates, count, maxChoices, beamWidth = 120) {
  if (count <= 0) return [{ items: [], score: 0 }];
  if (candidates.length < count) return [];

  let states = [{ items: [], score: 0, next: 0, prysmaradites: 0 }];
  for (let pick = 0; pick < count; pick++) {
    const nextStates = [];
    for (const state of states) {
      const remainingPicks = count - pick - 1;
      const last = candidates.length - remainingPicks;
      for (let index = state.next; index < last; index++) {
        const candidate = candidates[index];
        const nextPrysma = state.prysmaradites + (isPrysmaradite(candidate.item) ? 1 : 0);
        if (nextPrysma > 1) continue;
        nextStates.push({
          items: [...state.items, candidate.item],
          score: state.score + candidate.score,
          next: index + 1,
          prysmaradites: nextPrysma
        });
      }
    }

    nextStates.sort((a, b) => b.score - a.score);
    const deduped = [];
    const seen = new Set();
    for (const state of nextStates) {
      const key = choiceKey(state.items);
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(state);
      if (deduped.length >= beamWidth) break;
    }
    states = deduped;
    if (!states.length) break;
  }

  return states
    .sort((a, b) => b.score - a.score)
    .slice(0, maxChoices)
    .map(({ items, score }) => ({ items, score }));
}

function mutationVariants(architecture, synergy) {
  if (!architecture) return [{ label: 'standalones', anchorIds: [] }];
  const itemScore = new Map();
  for (const plan of architecture.plans) {
    (plan.memberIds || []).forEach((id, index) => {
      itemScore.set(String(id), Number(plan.memberScores?.[index] || 0));
    });
  }

  const baseIds = [...new Set(architecture.plans.flatMap((plan) => plan.memberIds || []).map(String))];
  const variants = [{ label: architecture.key, anchorIds: baseIds }];

  // One standalone/legendary replacement at the expense of a set tier.
  for (const plan of architecture.plans) {
    if (Number(plan.targetCount || 0) < 3) continue;
    const weakest = [...(plan.memberIds || [])]
      .map(String)
      .sort((a, b) => (itemScore.get(a) || 0) - (itemScore.get(b) || 0))[0];
    if (!weakest) continue;
    variants.push({
      label: `${architecture.key} · -1 ${plan.name}`,
      anchorIds: baseIds.filter((id) => id !== weakest)
    });
  }

  // Two replacement slots: test the common case where two very strong
  // standalones beat one or more set bonuses.
  const weakestGlobal = [...baseIds].sort((a, b) => (itemScore.get(a) || 0) - (itemScore.get(b) || 0));
  if (weakestGlobal.length >= 2) {
    const removed = new Set(weakestGlobal.slice(0, 2));
    variants.push({
      label: `${architecture.key} · -2 standalones`,
      anchorIds: baseIds.filter((id) => !removed.has(id))
    });
  }

  const fullPlan = architecture.plans.find((plan) => Number(plan.targetCount || 0) >= 4);
  if (fullPlan) {
    const weakestInSet = [...(fullPlan.memberIds || [])]
      .map(String)
      .sort((a, b) => (itemScore.get(a) || 0) - (itemScore.get(b) || 0))
      .slice(0, 2);
    if (weakestInSet.length === 2) {
      const removed = new Set(weakestInSet);
      variants.push({
        label: `${architecture.key} · ${fullPlan.name} ${fullPlan.targetCount}→${fullPlan.targetCount - 2}`,
        anchorIds: baseIds.filter((id) => !removed.has(id))
      });
    }
  }

  const unique = [];
  const seen = new Set();
  for (const variant of variants) {
    const key = [...variant.anchorIds].sort().join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(variant);
    if (unique.length >= 7) break;
  }
  return unique;
}

function slotCounts(items) {
  const counts = new Map();
  for (const item of items) counts.set(item.slot, (counts.get(item.slot) || 0) + 1);
  return counts;
}

function fullBuildShapeIsValid(items) {
  const counts = slotCounts(items);
  for (const rule of SLOT_RULES) {
    if ((counts.get(rule.id) || 0) !== Number(rule.count || 0)) return false;
  }
  return specialSlotRulesAreValid(items);
}

export function searchArchitectures({
  items = [],
  sets = [],
  selections = [],
  constraints = {},
  fmPolicy = {},
  turnMode = 'sum',
  scenario = {},
  topN = 10,
  onProgress = null
} = {}) {
  const elements = activeSpellElements(selections);
  const targetElement = elements.length === 1 ? elements[0] : null;
  const context = { selections, constraints, turnMode, scenario, targetElement };

  const prefilter = prefilterItems({
    items,
    sets,
    selections,
    constraints,
    turnMode,
    scenario,
    maxRelevantSets: 12,
    constraintReservePerStat: 5
  });

  const synergy = buildSetSynergyIndex({
    items,
    sets,
    selections,
    constraints,
    turnMode,
    scenario,
    maxPlans: 18,
    maxArchitectures: 72
  });

  const originalById = new Map(items.map((item) => [String(item.id), item]));
  const poolById = new Map(prefilter.items.map((item) => [String(item.id), item]));
  for (const plan of synergy.plans) {
    for (const id of plan.memberIds || []) {
      const item = originalById.get(String(id));
      if (item) poolById.set(String(item.id), item);
    }
  }
  const pool = [...poolById.values()];

  const rankedBySlot = new Map();
  for (const rule of SLOT_RULES) {
    const cap = SLOT_CANDIDATE_LIMIT[rule.id] || 9;
    const ranked = pool
      .filter((item) => item.slot === rule.id)
      .map((item) => ({ item, score: itemHeuristic(item, context) }))
      .sort((a, b) => b.score - a.score || String(a.item.id).localeCompare(String(b.item.id)))
      .slice(0, Math.max(rule.count, cap));
    rankedBySlot.set(rule.id, ranked);
  }

  const choiceCache = new Map();
  function choicesFor(slot, count) {
    const key = `${slot}:${count}`;
    if (choiceCache.has(key)) return choiceCache.get(key);
    const ranked = rankedBySlot.get(slot) || [];
    const limit = GROUP_CHOICE_LIMIT[slot] || 8;
    const choices = bestGroupChoices(ranked, count, limit, slot === 'dofus' ? 160 : 100);
    choiceCache.set(key, choices);
    return choices;
  }

  const architectureQueue = [];
  for (const architecture of synergy.architectures) {
    for (const variant of mutationVariants(architecture, synergy)) architectureQueue.push({ architecture, variant });
  }
  // Always keep a pure-standalone baseline, but after the strongest set-led
  // structures so the first result is already a plausible Dofus build.
  architectureQueue.push({ architecture: null, variant: { label: 'standalones', anchorIds: [] } });

  const results = [];
  const rejectReasons = new Map();
  let evaluated = 0;
  let valid = 0;
  let expandedStates = 0;

  function report(force = false, label = '') {
    if (!onProgress) return;
    if (!force && evaluated % 12 !== 0) return;
    onProgress({
      nodes: evaluated,
      visited: valid,
      pruned: [...rejectReasons.values()].reduce((sum, count) => sum + count, 0),
      best: results[0]?.score || 0,
      threshold: results.length >= topN ? results[results.length - 1].score : null,
      partialResults: results.length ? [...results] : null,
      seeded: true,
      phase: 'architectures',
      label
    });
  }

  for (const entry of architectureQueue) {
    const anchors = entry.variant.anchorIds
      .map((id) => originalById.get(String(id)))
      .filter(Boolean);
    const anchorIds = new Set(anchors.map((item) => String(item.id)));
    const counts = slotCounts(anchors);
    let impossible = false;
    for (const rule of SLOT_RULES) {
      if ((counts.get(rule.id) || 0) > Number(rule.count || 0)) impossible = true;
    }
    if (impossible) continue;

    let states = [{ items: anchors, ids: anchorIds, score: Number(entry.architecture?.score || 0) }];
    const missingGroups = SLOT_RULES
      .map((rule) => ({ ...rule, missing: Number(rule.count || 0) - (counts.get(rule.id) || 0) }))
      .filter((group) => group.missing > 0)
      .sort((a, b) => choicesFor(a.id, a.missing).length - choicesFor(b.id, b.missing).length);

    for (const group of missingGroups) {
      const choices = choicesFor(group.id, group.missing);
      if (!choices.length) {
        states = [];
        break;
      }
      const nextStates = [];
      for (const state of states) {
        for (const choice of choices) {
          if (choice.items.some((item) => state.ids.has(String(item.id)))) continue;
          const nextItems = [...state.items, ...choice.items];
          if (!specialSlotRulesAreValid(nextItems)) continue;
          nextStates.push({
            items: nextItems,
            ids: new Set([...state.ids, ...choice.items.map((item) => String(item.id))]),
            score: state.score + choice.score
          });
          expandedStates++;
        }
      }
      nextStates.sort((a, b) => b.score - a.score);
      const deduped = [];
      const seen = new Set();
      for (const state of nextStates) {
        const key = choiceKey(state.items);
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(state);
        if (deduped.length >= 48) break;
      }
      states = deduped;
      if (!states.length) break;
    }

    for (const state of states.slice(0, 14)) {
      if (!fullBuildShapeIsValid(state.items)) continue;
      const evaluation = evaluateCompleteBuild({
        items: state.items,
        sets,
        selections,
        constraints,
        fmPolicy: { ...fmPolicy, structuralExos: false },
        turnMode,
        scenario
      });
      evaluated++;
      if (evaluation.result) {
        valid++;
        insertTop(results, evaluation.result, Math.max(1, Number(topN || 10)));
      } else {
        rejectReasons.set(evaluation.reason || 'unknown', (rejectReasons.get(evaluation.reason || 'unknown') || 0) + 1);
      }
      report(false, entry.variant.label);
    }

    // Once a strong first result exists, we still visit the whole curated
    // architecture list, but there is no global combinatorial DFS afterwards.
    report(true, entry.variant.label);
  }

  return {
    results,
    diagnostics: {
      mode: 'architecture-search',
      profile: synergy.profile,
      targetElement: synergy.targetElement,
      setPlans: synergy.plans.map((plan) => ({
        setId: plan.setId,
        name: plan.name,
        targetCount: plan.targetCount,
        score: plan.score
      })),
      architectures: synergy.architectures.length,
      architectureVariants: architectureQueue.length,
      evaluated,
      valid,
      expandedStates,
      rejected: Object.fromEntries(rejectReasons),
      prefilter: prefilter.diagnostics,
      nodes: evaluated,
      visited: valid,
      pruned: [...rejectReasons.values()].reduce((sum, count) => sum + count, 0)
    }
  };
}
