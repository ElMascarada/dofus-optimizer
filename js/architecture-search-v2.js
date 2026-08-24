import { BASE_CHARACTER, SLOT_RULES } from './config.js';
import { prefilterItems, activeSpellElements } from './candidate-prefilter.js';
import { buildSetSynergyIndex } from './set-synergy-index.js';
import { evaluateCompleteBuild } from './complete-build-evaluator.js';
import { evaluateObjectiveUpperBound } from './spells.js';
import { optimisticItemStats } from './search-space.js';
import { addStats, emptyStats, stat } from './stats.js';
import { applySetBonuses } from './sets.js';
import { isPrysmaradite, specialSlotRulesAreValid } from './build-legality.js';

const LEVEL_200_SLOTS = new Set(['hat', 'cape', 'amulet', 'ring', 'belt', 'boots', 'weapon', 'shield']);
const ELEMENT_DAMAGE = { earth: 'damageEarth', fire: 'damageFire', water: 'damageWater', air: 'damageAir' };
const GENERIC_OFFENSE = [
  'power', 'damage', 'crit', 'critDamage', 'spellDamagePct',
  'finalDamagePct', 'finalDamagePctT1', 'finalDamagePctT2', 'finalDamagePctT3'
];

const SLOT_POOL_LIMIT = Object.freeze({
  dofus: 30,
  ring: 22,
  companion: 18,
  weapon: 16,
  hat: 14,
  cape: 14,
  amulet: 14,
  belt: 14,
  boots: 14,
  shield: 14
});

const GROUP_CHOICE_LIMIT = Object.freeze({
  dofus: 70,
  ring: 36,
  companion: 14,
  weapon: 12,
  hat: 12,
  cape: 12,
  amulet: 12,
  belt: 12,
  boots: 12,
  shield: 12
});

function num(stats, key) {
  const value = Number(stats?.[key] || 0);
  return Number.isFinite(value) ? value : 0;
}

function eligibleItem(item) {
  if (!LEVEL_200_SLOTS.has(item?.slot)) return true;
  return Number(item?.level || 0) === 200;
}

function resultKey(result) {
  return (result?.items || []).map((item) => String(item.id)).sort().join('|');
}

function insertTop(results, result, limit) {
  if (!result?.items?.length) return;
  const key = resultKey(result);
  const previous = results.findIndex((entry) => resultKey(entry) === key);
  if (previous >= 0) {
    if (results[previous].score >= result.score) return;
    results.splice(previous, 1);
  }
  results.push(result);
  results.sort((a, b) => b.score - a.score);
  if (results.length > limit) results.length = limit;
}

function itemScore(item, context) {
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
  score += Math.max(0, num(stats, 'ap')) * 85000;
  score += Math.max(0, num(stats, 'mp')) * 60000;
  score += Math.max(0, num(stats, 'range')) * 1200;

  if (context.targetElement) {
    score += Math.max(0, num(stats, context.targetElement)) * 28;
    score += Math.max(0, num(stats, ELEMENT_DAMAGE[context.targetElement])) * 36;
  }
  for (const key of GENERIC_OFFENSE) score += Math.max(0, num(stats, key)) * 7;

  // Keep standalone/legendary candidates competitive once a set skeleton exists.
  if (!item.setId && item.slot !== 'dofus' && item.slot !== 'companion') score += 2200;
  // Conditions/passives are not forbidden, but conditionless and deterministic
  // items are useful fallbacks when a high-scoring trophy/passive is illegal.
  if (!item.conditions) score += 1000;
  if (!(item.passives || []).length) score += 700;

  return { item, stats, score };
}

function uniqueProfiles(profiles, limit) {
  const seen = new Set();
  const output = [];
  for (const profile of profiles) {
    const id = String(profile.item.id);
    if (seen.has(id)) continue;
    seen.add(id);
    output.push(profile);
    if (output.length >= limit) break;
  }
  return output;
}

function buildSlotPool(allItems, preferredItems, rule, context) {
  const raw = allItems.filter((item) => eligibleItem(item) && item.slot === rule.id).map((item) => itemScore(item, context));
  const preferredIds = new Set(preferredItems.filter((item) => item.slot === rule.id).map((item) => String(item.id)));
  const preferred = raw.filter((profile) => preferredIds.has(String(profile.item.id))).sort((a, b) => b.score - a.score);
  const byScore = [...raw].sort((a, b) => b.score - a.score);
  const byAp = [...raw].sort((a, b) => num(b.stats, 'ap') - num(a.stats, 'ap') || b.score - a.score).slice(0, 6);
  const byMp = [...raw].sort((a, b) => num(b.stats, 'mp') - num(a.stats, 'mp') || b.score - a.score).slice(0, 6);
  const conditionless = byScore.filter((profile) => !profile.item.conditions).slice(0, 8);
  const passiveFree = byScore.filter((profile) => !(profile.item.passives || []).length).slice(0, 8);
  const realDofus = rule.id === 'dofus'
    ? byScore.filter((profile) => String(profile.item.typeName || '').toLowerCase().includes('dofus')).slice(0, 10)
    : [];

  const cap = Math.max(Number(rule.count || 0), SLOT_POOL_LIMIT[rule.id] || 14);
  return uniqueProfiles([...preferred, ...byAp, ...byMp, ...conditionless, ...passiveFree, ...realDofus, ...byScore], cap);
}

function choiceKey(items) {
  return items.map((item) => String(item.id)).sort().join('|');
}

function groupChoices(profiles, count, maxChoices) {
  if (count <= 0) return [{ items: [], score: 0 }];
  if (profiles.length < count) return [];
  if (count === 1) return profiles.slice(0, maxChoices).map((profile) => ({ items: [profile.item], score: profile.score }));

  let states = [{ items: [], score: 0, next: 0, prysma: 0 }];
  const beamWidth = count >= 5 ? 260 : 160;
  for (let pick = 0; pick < count; pick++) {
    const nextStates = [];
    const leftAfter = count - pick - 1;
    for (const state of states) {
      const last = profiles.length - leftAfter;
      for (let index = state.next; index < last; index++) {
        const profile = profiles[index];
        const nextPrysma = state.prysma + (isPrysmaradite(profile.item) ? 1 : 0);
        if (nextPrysma > 1) continue;
        nextStates.push({
          items: [...state.items, profile.item],
          score: state.score + profile.score,
          next: index + 1,
          prysma: nextPrysma
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
  return states.sort((a, b) => b.score - a.score).slice(0, maxChoices).map(({ items, score }) => ({ items, score }));
}

function slotCounts(items) {
  const counts = new Map();
  for (const item of items) counts.set(item.slot, (counts.get(item.slot) || 0) + 1);
  return counts;
}

function fullShape(items) {
  const counts = slotCounts(items);
  return SLOT_RULES.every((rule) => (counts.get(rule.id) || 0) === Number(rule.count || 0)) && specialSlotRulesAreValid(items);
}

function staticBuildStats(items, setsById) {
  const stats = emptyStats();
  addStats(stats, BASE_CHARACTER.baseStats || {});
  for (const item of items) addStats(stats, item.stats || {});
  applySetBonuses(stats, items, setsById);
  return stats;
}

function legalityPriority(items, heuristic, context) {
  const stats = staticBuildStats(items, context.setsById);
  const apTarget = Math.max(0, Number(context.constraints.ap || 0));
  const mpTarget = Math.max(0, Number(context.constraints.mp || 0));
  const ap = num(stats, 'ap');
  const mp = num(stats, 'mp');
  const apMissing = Math.max(0, apTarget - ap);
  const mpMissing = Math.max(0, mpTarget - mp);
  const ready = apMissing === 0 && mpMissing === 0;
  // Legality dominates offense while building the beam. Once 12/6 is reached,
  // the original offensive heuristic decides between alternatives.
  const score = heuristic
    - apMissing * 240000
    - mpMissing * 180000
    + Math.min(ap, apTarget || ap) * 9000
    + Math.min(mp, mpTarget || mp) * 7000
    + (ready ? 500000 : 0);
  return { score, ap, mp, ready };
}

function stateBucket(priority, items) {
  const setCounts = new Map();
  for (const item of items) if (item.setId) setCounts.set(item.setId, (setCounts.get(item.setId) || 0) + 1);
  const setSignature = [...setCounts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
    .map(([id, count]) => `${id}:${Math.min(count, 4)}`)
    .join(',');
  return `${Math.min(priority.ap, 12)}:${Math.min(priority.mp, 6)}:${setSignature}`;
}

function keepDiverseStates(states, context, limit = 160) {
  for (const state of states) state.priority = legalityPriority(state.items, state.heuristic, context);
  states.sort((a, b) => b.priority.score - a.priority.score);
  const perBucket = new Map();
  const output = [];
  for (const state of states) {
    const bucket = stateBucket(state.priority, state.items);
    const used = perBucket.get(bucket) || 0;
    if (used >= 5) continue;
    perBucket.set(bucket, used + 1);
    output.push(state);
    if (output.length >= limit) break;
  }
  return output;
}

function mutationVariants(architecture) {
  if (!architecture) return [{ label: 'standalones', anchorIds: [] }];
  const baseIds = [...new Set(architecture.plans.flatMap((plan) => plan.memberIds || []).map(String))];
  const scoreById = new Map();
  for (const plan of architecture.plans) {
    (plan.memberIds || []).forEach((id, index) => scoreById.set(String(id), Number(plan.memberScores?.[index] || 0)));
  }
  const variants = [{ label: architecture.key, anchorIds: baseIds }];
  for (const plan of architecture.plans) {
    if (Number(plan.targetCount || 0) < 3) continue;
    const weakest = [...(plan.memberIds || [])].map(String).sort((a, b) => (scoreById.get(a) || 0) - (scoreById.get(b) || 0))[0];
    if (weakest) variants.push({ label: `${architecture.key} · -1 ${plan.name}`, anchorIds: baseIds.filter((id) => id !== weakest) });
  }
  const weakest = [...baseIds].sort((a, b) => (scoreById.get(a) || 0) - (scoreById.get(b) || 0));
  if (weakest.length >= 2) {
    const removed = new Set(weakest.slice(0, 2));
    variants.push({ label: `${architecture.key} · -2 standalones`, anchorIds: baseIds.filter((id) => !removed.has(id)) });
  }
  const seen = new Set();
  return variants.filter((variant) => {
    const key = [...variant.anchorIds].sort().join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 6);
}

export function searchArchitecturesV2({
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
  const context = {
    selections,
    constraints,
    turnMode,
    scenario,
    targetElement,
    setsById: Object.fromEntries((sets || []).map((set) => [set.id, set]))
  };

  const prefilter = prefilterItems({
    items,
    sets,
    selections,
    constraints,
    turnMode,
    scenario,
    maxRelevantSets: 14,
    constraintReservePerStat: 8
  });
  const synergy = buildSetSynergyIndex({
    items,
    sets,
    selections,
    constraints,
    turnMode,
    scenario,
    maxPlans: 24,
    maxArchitectures: 90
  });

  const rawEligible = items.filter(eligibleItem);
  const preferredById = new Map(prefilter.items.map((item) => [String(item.id), item]));
  const originalById = new Map(items.map((item) => [String(item.id), item]));
  for (const plan of synergy.plans) {
    for (const id of plan.memberIds || []) {
      const item = originalById.get(String(id));
      if (item) preferredById.set(String(item.id), item);
    }
  }
  const preferred = [...preferredById.values()];

  const slotPools = new Map();
  for (const rule of SLOT_RULES) slotPools.set(rule.id, buildSlotPool(rawEligible, preferred, rule, context));

  const choiceCache = new Map();
  function choicesFor(slot, count) {
    const key = `${slot}:${count}`;
    if (choiceCache.has(key)) return choiceCache.get(key);
    const profiles = slotPools.get(slot) || [];
    const choices = groupChoices(profiles, count, GROUP_CHOICE_LIMIT[slot] || 12);
    choiceCache.set(key, choices);
    return choices;
  }

  const queue = [];
  for (const architecture of synergy.architectures) {
    for (const variant of mutationVariants(architecture)) queue.push({ architecture, variant });
  }
  queue.push({ architecture: null, variant: { label: 'standalones', anchorIds: [] } });

  const results = [];
  const rejectReasons = new Map();
  let evaluated = 0;
  let valid = 0;
  let expandedStates = 0;
  let legalCandidates = 0;

  function report(label = '') {
    if (!onProgress) return;
    onProgress({
      nodes: evaluated,
      visited: valid,
      pruned: [...rejectReasons.values()].reduce((sum, value) => sum + value, 0),
      best: results[0]?.score || 0,
      threshold: results.length >= topN ? results[results.length - 1].score : null,
      partialResults: results.length ? [...results] : null,
      seeded: true,
      phase: 'architectures-v2',
      label,
      rejected: Object.fromEntries(rejectReasons)
    });
  }

  for (const entry of queue) {
    const anchors = entry.variant.anchorIds.map((id) => originalById.get(String(id))).filter(Boolean);
    const anchorIds = new Set(anchors.map((item) => String(item.id)));
    const counts = slotCounts(anchors);
    if (SLOT_RULES.some((rule) => (counts.get(rule.id) || 0) > Number(rule.count || 0))) continue;

    let states = [{ items: anchors, ids: anchorIds, heuristic: Number(entry.architecture?.score || 0) }];
    const missing = SLOT_RULES
      .map((rule) => ({ ...rule, missing: Number(rule.count || 0) - (counts.get(rule.id) || 0) }))
      .filter((group) => group.missing > 0)
      .sort((a, b) => choicesFor(a.id, a.missing).length - choicesFor(b.id, b.missing).length);

    for (const group of missing) {
      const choices = choicesFor(group.id, group.missing);
      const next = [];
      for (const state of states) {
        for (const choice of choices) {
          if (choice.items.some((item) => state.ids.has(String(item.id)))) continue;
          const nextItems = [...state.items, ...choice.items];
          if (!specialSlotRulesAreValid(nextItems)) continue;
          next.push({
            items: nextItems,
            ids: new Set([...state.ids, ...choice.items.map((item) => String(item.id))]),
            heuristic: state.heuristic + choice.score
          });
          expandedStates++;
        }
      }
      states = keepDiverseStates(next, context, 180);
      if (!states.length) break;
    }

    const complete = states.filter((state) => fullShape(state.items));
    complete.sort((a, b) => {
      const pa = legalityPriority(a.items, a.heuristic, context);
      const pb = legalityPriority(b.items, b.heuristic, context);
      return Number(pb.ready) - Number(pa.ready) || pb.score - pa.score;
    });

    const readyStates = complete.filter((state) => legalityPriority(state.items, state.heuristic, context).ready);
    legalCandidates += readyStates.length;
    const evaluationPool = (readyStates.length ? readyStates : complete).slice(0, 36);

    for (const state of evaluationPool) {
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
        const reason = evaluation.reason || 'unknown';
        rejectReasons.set(reason, (rejectReasons.get(reason) || 0) + 1);
      }
      if (evaluated % 12 === 0 || evaluation.result) report(entry.variant.label);
    }
    report(entry.variant.label);
  }

  return {
    results,
    diagnostics: {
      mode: 'architecture-search-v2',
      profile: synergy.profile,
      targetElement: synergy.targetElement,
      architectures: synergy.architectures.length,
      architectureVariants: queue.length,
      evaluated,
      valid,
      legalCandidates,
      expandedStates,
      rejected: Object.fromEntries(rejectReasons),
      prefilter: prefilter.diagnostics,
      nodes: evaluated,
      visited: valid,
      pruned: [...rejectReasons.values()].reduce((sum, value) => sum + value, 0)
    }
  };
}
