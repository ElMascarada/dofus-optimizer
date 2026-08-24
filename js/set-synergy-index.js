import { SLOT_RULES } from './config.js';
import { activeSpellElements } from './candidate-prefilter.js';
import { evaluateObjectiveUpperBound } from './spells.js';
import { optimisticItemStats } from './search-space.js';

const ENDGAME_SET_SLOTS = new Set([
  'hat', 'cape', 'amulet', 'ring', 'belt', 'boots', 'weapon', 'shield'
]);

const ELEMENT_DAMAGE = {
  earth: 'damageEarth',
  fire: 'damageFire',
  water: 'damageWater',
  air: 'damageAir'
};

const GENERIC_OFFENSE = [
  'power', 'damage', 'crit', 'critDamage', 'spellDamagePct',
  'meleeDamagePct', 'rangedDamagePct',
  'finalDamagePct', 'finalDamagePctT1', 'finalDamagePctT2', 'finalDamagePctT3'
];

function num(stats, key) {
  const value = Number(stats?.[key] || 0);
  return Number.isFinite(value) ? value : 0;
}

function addStats(target, source = {}) {
  for (const [key, raw] of Object.entries(source || {})) {
    const value = Number(raw || 0);
    if (!Number.isFinite(value) || value === 0) continue;
    target[key] = Number(target[key] || 0) + value;
  }
  return target;
}

function slotCapacities(slotRules = SLOT_RULES) {
  return new Map((slotRules || SLOT_RULES).map((rule) => [rule.id, Number(rule.count || 0)]));
}

function targetValue(stats, element) {
  if (!element) return 0;
  return Math.max(0, num(stats, element)) + Math.max(0, num(stats, ELEMENT_DAMAGE[element]));
}

function genericValue(stats) {
  return GENERIC_OFFENSE.reduce((sum, key) => sum + Math.max(0, num(stats, key)), 0);
}

function otherElementValue(stats, targetElement) {
  if (!targetElement) return 0;
  let total = 0;
  for (const element of ['earth', 'fire', 'water', 'air']) {
    if (element === targetElement) continue;
    total += Math.max(0, num(stats, element));
    total += Math.max(0, num(stats, ELEMENT_DAMAGE[element]));
  }
  return total;
}

function scoreStats(stats, context) {
  const objective = evaluateObjectiveUpperBound({
    stats,
    selections: context.selections,
    turnMode: context.turnMode
  }).score;
  const target = targetValue(stats, context.targetElement);
  const generic = genericValue(stats);
  const other = otherElementValue(stats, context.targetElement);
  const baseline = Number(context.baselineObjective || 0);
  const objectiveGain = Number.isFinite(objective) ? Math.max(0, objective - baseline) : 0;

  let score = objectiveGain * 100;
  score += Math.max(0, num(stats, 'ap')) * 50000;
  score += Math.max(0, num(stats, 'mp')) * 32000;
  score += Math.max(0, num(stats, 'range')) * 1500;
  score += Math.max(0, num(stats, 'spellDamagePct')) * 1200;
  score += Math.max(0, num(stats, 'finalDamagePct')) * 1200;
  if (context.targetElement) score += target * 1.25 + generic - other * 0.05;
  else score += generic;
  return { score, objective: Number.isFinite(objective) ? objective : 0, target, generic };
}

function profileItem(item, context) {
  const stats = optimisticItemStats(item, {
    includePassives: true,
    turnMode: context.turnMode,
    scenario: context.scenario
  }).stats;
  return { item, stats, ...scoreStats(stats, context) };
}

function chooseMembers(profiles, count, capacities) {
  const selected = [];
  const usedBySlot = new Map();
  const sorted = [...profiles].sort((a, b) => b.score - a.score || String(a.item.id).localeCompare(String(b.item.id)));
  for (const profile of sorted) {
    const slot = profile.item.slot;
    const used = usedBySlot.get(slot) || 0;
    if (used >= (capacities.get(slot) || 0)) continue;
    selected.push(profile);
    usedBySlot.set(slot, used + 1);
    if (selected.length >= count) break;
  }
  return selected;
}

function planKey(plan) {
  return `${plan.setId}:${plan.targetCount}`;
}

function architectureKey(plans) {
  return plans.map(planKey).sort().join('|');
}

function architectureCompatible(plans, itemById, capacities) {
  const setIds = new Set();
  const itemIds = new Set();
  const slots = new Map();
  for (const plan of plans) {
    if (setIds.has(plan.setId)) return false;
    setIds.add(plan.setId);
    for (const rawId of plan.memberIds || []) {
      const id = String(rawId);
      if (itemIds.has(id)) continue;
      const item = itemById.get(id);
      if (!item) return false;
      itemIds.add(id);
      const next = (slots.get(item.slot) || 0) + 1;
      if (next > (capacities.get(item.slot) || 0)) return false;
      slots.set(item.slot, next);
    }
  }
  return itemIds.size <= 9;
}

function structureBonus(plans) {
  const counts = plans.map((plan) => Number(plan.targetCount || 0)).sort((a, b) => b - a);
  let score = 0;
  for (const count of counts) {
    if (count >= 4) score += 9000;
    else if (count === 3) score += 7000;
    else if (count === 2) score += 3000;
  }
  if (counts.join(',') === '3,3,3') score += 18000;
  if (counts.join(',') === '3,2,2,2') score += 16000;
  return score;
}

function buildArchitectures(plans, items, slotRules, maxArchitectures) {
  const itemById = new Map(items.map((item) => [String(item.id), item]));
  const capacities = slotCapacities(slotRules);
  const architectures = new Map();

  function add(combo) {
    if (!combo.length || !architectureCompatible(combo, itemById, capacities)) return;
    const key = architectureKey(combo);
    if (architectures.has(key)) return;
    architectures.set(key, {
      key,
      plans: [...combo],
      score: combo.reduce((sum, plan) => sum + Number(plan.score || 0), 0) + structureBonus(combo),
      pieceCount: new Set(combo.flatMap((plan) => plan.memberIds || []).map(String)).size
    });
  }

  function visit(start, size, combo) {
    if (combo.length === size) {
      add(combo);
      return;
    }
    for (let index = start; index < plans.length; index++) {
      combo.push(plans[index]);
      if (architectureCompatible(combo, itemById, capacities)) visit(index + 1, size, combo);
      combo.pop();
    }
  }

  for (const plan of plans) add([plan]);
  for (const size of [2, 3, 4]) visit(0, size, []);

  const all = [...architectures.values()].sort((a, b) => b.score - a.score || b.pieceCount - a.pieceCount);
  if (!plans.length) return [];
  const primarySetId = plans[0].setId;
  const primary = all
    .filter((architecture) => architecture.plans.some((plan) => plan.setId === primarySetId))
    .sort((a, b) => a.plans.length - b.plans.length || b.score - a.score);
  const rest = all.filter((architecture) => !architecture.plans.some((plan) => plan.setId === primarySetId));

  const ordered = [];
  const seen = new Set();
  for (const architecture of [...primary, ...rest]) {
    if (seen.has(architecture.key)) continue;
    seen.add(architecture.key);
    ordered.push(architecture);
    if (ordered.length >= maxArchitectures) break;
  }
  return ordered;
}

export function buildSetSynergyIndex({
  items = [],
  sets = [],
  selections = [],
  constraints = {},
  turnMode = 'sum',
  scenario = {},
  slotRules = SLOT_RULES,
  maxPlans = 20,
  maxArchitectures = 72
} = {}) {
  const elements = activeSpellElements(selections);
  const targetElement = elements.length === 1 ? elements[0] : null;
  const context = {
    targetElement,
    selections,
    constraints,
    turnMode,
    scenario,
    baselineObjective: evaluateObjectiveUpperBound({ stats: {}, selections, turnMode }).score || 0
  };

  // Set planning must use the same certified endgame scope as the rest of the
  // optimizer. A level-197 ring can be the best piece of a set and must not be
  // silently excluded just because the architecture index used to require 200.
  const eligible = items.filter((item) => {
    if (!item?.setId || !ENDGAME_SET_SLOTS.has(item.slot)) return false;
    const level = Number(item.level || 0);
    return level >= 190 && level <= 200;
  });

  const bySet = new Map();
  for (const item of eligible) {
    if (!bySet.has(item.setId)) bySet.set(item.setId, []);
    bySet.get(item.setId).push(profileItem(item, context));
  }

  const capacities = slotCapacities(slotRules);
  const allPlans = [];
  for (const set of sets || []) {
    const profiles = bySet.get(set.id) || [];
    if (!profiles.length) continue;
    for (const [countText, bonus] of Object.entries(set.bonuses || {})) {
      const count = Number(countText);
      if (!Number.isInteger(count) || count < 2) continue;
      const members = chooseMembers(profiles, count, capacities);
      if (members.length < count) continue;

      const combined = {};
      for (const member of members) addStats(combined, member.stats);
      addStats(combined, bonus);
      const combinedProfile = scoreStats(combined, context);
      const bonusProfile = scoreStats(bonus || {}, context);
      const monoRelevant = !targetElement
        || combinedProfile.target > 0
        || combinedProfile.generic > 0
        || num(combined, 'ap') > 0
        || num(combined, 'mp') > 0;
      if (!monoRelevant) continue;

      const structural = count >= 3 ? 12000 + count * 3500 : 4500;
      const payoff = Math.max(0, num(bonus, 'ap')) * 60000 + Math.max(0, num(bonus, 'mp')) * 40000;
      allPlans.push({
        setId: set.id,
        name: set.name || set.id,
        targetCount: count,
        memberIds: members.map((member) => String(member.item.id)),
        memberScores: members.map((member) => Number(member.score || 0)),
        bonus: { ...(bonus || {}) },
        score: combinedProfile.score + bonusProfile.score * 0.8 + structural + payoff
      });
    }
  }

  const grouped = new Map();
  for (const plan of allPlans) {
    if (!grouped.has(plan.setId)) grouped.set(plan.setId, []);
    grouped.get(plan.setId).push(plan);
  }

  const retained = [];
  for (const plans of grouped.values()) {
    plans.sort((a, b) => b.score - a.score);
    const picks = [
      plans[0],
      plans.find((plan) => plan.targetCount === 2),
      plans.find((plan) => plan.targetCount === 3),
      [...plans].sort((a, b) => b.targetCount - a.targetCount || b.score - a.score)[0]
    ].filter(Boolean);
    for (const plan of picks) {
      if (!retained.some((entry) => planKey(entry) === planKey(plan))) retained.push(plan);
    }
  }

  retained.sort((a, b) => b.score - a.score || b.targetCount - a.targetCount);
  const plans = retained.slice(0, Math.max(1, Number(maxPlans || 20)));
  const architectures = buildArchitectures(plans, eligible, slotRules, Math.max(1, Number(maxArchitectures || 72)));

  return {
    profile: targetElement ? `mono-${targetElement}` : 'multi',
    targetElement,
    plans,
    architectures
  };
}
