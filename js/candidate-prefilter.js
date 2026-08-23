import { SLOT_RULES } from './config.js';
import { evaluateObjectiveUpperBound } from './spells.js';
import { optimisticItemStats } from './search-space.js';

const ELEMENTS = ['earth', 'fire', 'water', 'air'];
const DAMAGE_STAT_BY_ELEMENT = {
  earth: 'damageEarth',
  fire: 'damageFire',
  water: 'damageWater',
  air: 'damageAir'
};

const GENERIC_OFFENSE_KEYS = [
  'power', 'damage', 'crit', 'critDamage', 'spellDamagePct',
  'finalDamagePct', 'finalDamagePctT1', 'finalDamagePctT2', 'finalDamagePctT3',
  'meleeDamagePct', 'rangedDamagePct'
];

// The exact solver is still responsible for the final ranking. These limits only
// define the high-quality shortlist it receives. Multi-pick slots are deliberately
// tighter because they dominate the combinatorial cost (especially 6 Dofus).
const SLOT_LIMITS = Object.freeze({
  dofus: 22,
  ring: 20,
  weapon: 20,
  companion: 18,
  hat: 18,
  cape: 18,
  amulet: 18,
  belt: 18,
  boots: 18,
  shield: 18
});

const MAX_RELEVANT_SETS = 6;
const CONSTRAINT_RESERVE_PER_STAT = 4;

function number(stats, key) {
  const value = Number(stats?.[key] || 0);
  return Number.isFinite(value) ? value : 0;
}

function normalizedHitElement(element) {
  return element === 'neutral' ? 'earth' : element;
}

export function activeSpellElements(selections = []) {
  const elements = new Set();
  for (const selection of selections || []) {
    if (!selection?.enabled) continue;
    for (const hit of selection.spell?.hits || []) {
      const element = normalizedHitElement(hit.element || 'earth');
      if (ELEMENTS.includes(element)) elements.add(element);
    }
  }
  return [...elements];
}

function effectiveSearchConstraints(constraints = {}, scenario = {}) {
  const requiredByTurn = Object.values(scenario?.requiredApByTurn || {})
    .map((value) => Number(value || 0))
    .filter(Number.isFinite);
  const comboAp = requiredByTurn.length ? Math.max(...requiredByTurn) : 0;
  return {
    ...constraints,
    ap: Math.max(Number(constraints?.ap || 0), comboAp)
  };
}

function positiveConstraintContribution(stats, constraints = {}) {
  let score = 0;
  for (const [key, minimumRaw] of Object.entries(constraints || {})) {
    const minimum = Number(minimumRaw || 0);
    if (!(minimum > 0)) continue;
    const contribution = Math.max(0, number(stats, key));
    if (contribution <= 0) continue;
    score += Math.min(1, contribution / minimum) * 10000;
  }
  return score;
}

function genericOffenseValue(stats) {
  return GENERIC_OFFENSE_KEYS.reduce((sum, key) => sum + Math.max(0, number(stats, key)), 0);
}

function targetElementValue(stats, targetElement) {
  if (!targetElement) return 0;
  return Math.max(0, number(stats, targetElement))
    + Math.max(0, number(stats, DAMAGE_STAT_BY_ELEMENT[targetElement]));
}

function otherElementValue(stats, targetElement) {
  if (!targetElement) return 0;
  let total = 0;
  for (const element of ELEMENTS) {
    if (element === targetElement) continue;
    total += Math.max(0, number(stats, element));
    total += Math.max(0, number(stats, DAMAGE_STAT_BY_ELEMENT[element]));
  }
  return total;
}

function addNumericStats(target, source) {
  for (const [key, raw] of Object.entries(source || {})) {
    const value = Number(raw || 0);
    if (!Number.isFinite(value) || value === 0) continue;
    target[key] = Number(target[key] || 0) + value;
  }
  return target;
}

function statsProfile(stats, { targetElement, constraints, selections, turnMode }) {
  const objective = evaluateObjectiveUpperBound({ stats: stats || {}, selections, turnMode }).score;
  const constraint = positiveConstraintContribution(stats, constraints);
  const target = targetElementValue(stats, targetElement);
  const generic = genericOffenseValue(stats);
  const other = otherElementValue(stats, targetElement);
  let score = constraint + (Number.isFinite(objective) ? Math.max(0, objective) : 0);
  if (targetElement) {
    score += target * 35;
    score += generic * 6;
    score -= other * 2;
  } else {
    score += generic * 4;
  }
  return {
    relevant: target > 0 || generic > 0 || constraint > 0 || (Number.isFinite(objective) && objective > 0),
    score,
    objective: Number.isFinite(objective) ? objective : 0,
    constraint,
    target,
    generic,
    other
  };
}

function baseItemProfile(item, context) {
  const optimistic = optimisticItemStats(item, {
    includePassives: true,
    turnMode: context.turnMode,
    scenario: context.scenario
  }).stats;
  const profile = statsProfile(optimistic, context);
  return { item, optimistic, ...profile };
}

function slotCapacities(slotRules = SLOT_RULES) {
  return new Map((slotRules || SLOT_RULES).map((rule) => [rule.id, Math.max(1, Number(rule.count || 1))]));
}

function chooseSetMembers(profiles, count, capacities) {
  const selected = [];
  const bySlot = new Map();
  const sorted = [...profiles].sort((a, b) => b.score - a.score || String(a.item.id).localeCompare(String(b.item.id)));
  for (const profile of sorted) {
    const slot = profile.item?.slot;
    const cap = capacities.get(slot) || 1;
    const used = bySlot.get(slot) || 0;
    if (used >= cap) continue;
    selected.push(profile);
    bySlot.set(slot, used + 1);
    if (selected.length >= count) break;
  }
  return selected;
}

// Score each useful set at the tier where item stats + the exact tier bonus form
// the strongest coherent block. This catches both mono-element sets (e.g. large
// Fire on every piece) and Do Crit sets where the payoff lives partly in the bonus.
function buildRelevantSetPlans(sets, items, context, slotRules) {
  const profilesBySet = new Map();
  for (const item of items || []) {
    if (!item?.setId) continue;
    if (!profilesBySet.has(item.setId)) profilesBySet.set(item.setId, []);
    profilesBySet.get(item.setId).push(baseItemProfile(item, context));
  }

  const capacities = slotCapacities(slotRules);
  const plans = new Map();
  for (const set of sets || []) {
    if (!set?.id) continue;
    const members = profilesBySet.get(set.id) || [];
    if (!members.length) continue;

    let best = null;
    for (const [countText, bonus] of Object.entries(set?.bonuses || {})) {
      const count = Number(countText);
      if (!Number.isInteger(count) || count <= 0) continue;
      const selected = chooseSetMembers(members, count, capacities);
      if (selected.length < count) continue;

      const combined = {};
      for (const member of selected) addNumericStats(combined, member.optimistic);
      addNumericStats(combined, bonus);

      const combinedProfile = statsProfile(combined, context);
      const bonusProfile = statsProfile(bonus, context);
      if (!combinedProfile.relevant && !bonusProfile.relevant) continue;

      // Per-slot quality prevents a large set from winning only because it uses
      // more slots; the extra bonus term rewards actual set synergy.
      const score = (combinedProfile.score / count) + (bonusProfile.score * 0.8);
      if (!best || score > best.score) {
        best = {
          setId: set.id,
          name: set.name || set.id,
          targetCount: count,
          score,
          memberIds: new Set(selected.map((profile) => profile.item.id))
        };
      }
    }
    if (best) plans.set(set.id, best);
  }
  return plans;
}

function itemProfile(item, context) {
  const base = baseItemProfile(item, context);
  const setPlan = context.relevantSetPlans.get(item?.setId) || null;
  const setRelevant = Boolean(setPlan);
  const plannedSetPiece = Boolean(setPlan?.memberIds?.has(item.id));

  // In mono-element mode, an item must contribute to the chosen element,
  // provide generic damage / a hard constraint, or belong to a set whose
  // coherent tier is strong enough to matter. Pure off-element pieces vanish.
  const monoRelevant = !context.targetElement
    || base.target > 0
    || base.generic > 0
    || base.constraint > 0
    || setRelevant;

  let score = base.score;
  if (setRelevant) score += setPlan.score * (plannedSetPiece ? 0.9 : 0.35);

  return {
    ...base,
    monoRelevant,
    score,
    setRelevant,
    plannedSetPiece
  };
}

function reserveConstraintSpecialists(profiles, constraints, selectedIds) {
  for (const [key, minimumRaw] of Object.entries(constraints || {})) {
    if (!(Number(minimumRaw || 0) > 0)) continue;
    const specialists = profiles
      .filter((profile) => number(profile.optimistic, key) > 0)
      .sort((a, b) => number(b.optimistic, key) - number(a.optimistic, key) || b.score - a.score)
      .slice(0, CONSTRAINT_RESERVE_PER_STAT);
    for (const profile of specialists) selectedIds.add(profile.item.id);
  }
}

function reserveRelevantSetPieces(profiles, relevantSetPlans, selectedIds) {
  const bestPlans = [...relevantSetPlans.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_RELEVANT_SETS);

  for (const plan of bestPlans) {
    for (const profile of profiles) {
      if (profile.item?.setId !== plan.setId) continue;
      if (plan.memberIds.has(profile.item.id)) selectedIds.add(profile.item.id);
    }
  }
}

function shortlistSlot(items, rule, context) {
  const allProfiles = items
    .filter((item) => item?.slot === rule.id)
    .map((item) => itemProfile(item, context))
    .sort((a, b) => b.score - a.score || String(a.item.id).localeCompare(String(b.item.id)));

  const monoProfiles = context.targetElement
    ? allProfiles.filter((profile) => profile.monoRelevant)
    : allProfiles;

  // Never make a mandatory slot impossible only because the mono filter was
  // too strict. Fall back to the best remaining pieces solely to fill the slot.
  const eligible = [...monoProfiles];
  if (eligible.length < rule.count) {
    for (const profile of allProfiles) {
      if (eligible.includes(profile)) continue;
      eligible.push(profile);
      if (eligible.length >= rule.count) break;
    }
  }

  const cap = Math.max(rule.count, SLOT_LIMITS[rule.id] || 18);
  if (eligible.length <= cap) {
    return {
      items: eligible.map((profile) => profile.item),
      before: allProfiles.length,
      afterMono: monoProfiles.length,
      afterShortlist: eligible.length
    };
  }

  const selectedIds = new Set();
  reserveConstraintSpecialists(eligible, context.constraints, selectedIds);
  reserveRelevantSetPieces(eligible, context.relevantSetPlans, selectedIds);

  for (const profile of eligible) {
    if (selectedIds.size >= cap) break;
    selectedIds.add(profile.item.id);
  }

  // A small overflow is preferable to destroying a coherent high-value set.
  // In practice the reserve is bounded by the top six set plans.
  const shortlisted = eligible.filter((profile) => selectedIds.has(profile.item.id));
  return {
    items: shortlisted.map((profile) => profile.item),
    before: allProfiles.length,
    afterMono: monoProfiles.length,
    afterShortlist: shortlisted.length
  };
}

export function prefilterItems({
  items = [],
  sets = [],
  selections = [],
  constraints = {},
  turnMode = 'sum',
  scenario = {},
  slotRules = SLOT_RULES
} = {}) {
  const elements = activeSpellElements(selections);
  const targetElement = elements.length === 1 ? elements[0] : null;
  const searchConstraints = effectiveSearchConstraints(constraints, scenario);
  const context = {
    targetElement,
    constraints: searchConstraints,
    selections,
    turnMode,
    scenario,
    relevantSetPlans: null
  };
  context.relevantSetPlans = buildRelevantSetPlans(sets, items, context, slotRules);

  const output = [];
  const slots = [];
  for (const rule of slotRules || SLOT_RULES) {
    const result = shortlistSlot(items, rule, context);
    output.push(...result.items);
    slots.push({
      id: rule.id,
      count: rule.count,
      before: result.before,
      afterMono: result.afterMono,
      afterShortlist: result.afterShortlist
    });
  }

  const topSetPlans = [...context.relevantSetPlans.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_RELEVANT_SETS)
    .map((plan) => ({ setId: plan.setId, name: plan.name, targetCount: plan.targetCount }));

  return {
    items: output,
    diagnostics: {
      mode: targetElement ? 'mono-element' : 'multi-element',
      targetElement,
      apTarget: searchConstraints.ap || 0,
      before: items.length,
      after: output.length,
      relevantSets: context.relevantSetPlans.size,
      topSetPlans,
      slots
    }
  };
}
