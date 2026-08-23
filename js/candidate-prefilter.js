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

const SLOT_LIMITS = Object.freeze({
  dofus: 32,
  ring: 28,
  weapon: 28,
  companion: 24,
  hat: 24,
  cape: 24,
  amulet: 24,
  belt: 24,
  boots: 24,
  shield: 24
});

const MAX_RELEVANT_SETS = 8;
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

function bonusProfile(bonus, { targetElement, constraints, selections, turnMode }) {
  const objective = evaluateObjectiveUpperBound({ stats: bonus || {}, selections, turnMode }).score;
  const constraint = positiveConstraintContribution(bonus, constraints);
  const target = targetElementValue(bonus, targetElement);
  const generic = genericOffenseValue(bonus);
  return {
    relevant: target > 0 || generic > 0 || constraint > 0,
    score: constraint + (Number.isFinite(objective) ? Math.max(0, objective) : 0) + target * 25 + generic * 5
  };
}

function buildRelevantSetScores(sets, context) {
  const scores = new Map();
  for (const set of sets || []) {
    let best = 0;
    let relevant = false;
    for (const bonus of Object.values(set?.bonuses || {})) {
      const profile = bonusProfile(bonus, context);
      relevant ||= profile.relevant;
      best = Math.max(best, profile.score);
    }
    if (relevant && set?.id) scores.set(set.id, best);
  }
  return scores;
}

function itemProfile(item, context) {
  const optimistic = optimisticItemStats(item, {
    includePassives: true,
    turnMode: context.turnMode,
    scenario: context.scenario
  }).stats;
  const objective = evaluateObjectiveUpperBound({
    stats: optimistic,
    selections: context.selections,
    turnMode: context.turnMode
  }).score;
  const constraintScore = positiveConstraintContribution(optimistic, context.constraints);
  const target = targetElementValue(optimistic, context.targetElement);
  const generic = genericOffenseValue(optimistic);
  const other = otherElementValue(optimistic, context.targetElement);
  const setScore = context.relevantSetScores.get(item?.setId) || 0;
  const setRelevant = setScore > 0;

  // In mono-element mode, an item must contribute to the chosen element,
  // provide generic damage / a hard constraint, or unlock a relevant set bonus.
  // Purely off-element pieces are discarded before the expensive exact search.
  const monoRelevant = !context.targetElement
    || target > 0
    || generic > 0
    || constraintScore > 0
    || setRelevant;

  let score = constraintScore + (Number.isFinite(objective) ? objective : 0);
  if (context.targetElement) {
    score += target * 35;
    score += generic * 6;
    score -= other * 2;
  }
  if (setRelevant) score += setScore * 0.65;

  return { item, optimistic, monoRelevant, score, target, generic, other, setRelevant };
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

function reserveRelevantSetPieces(profiles, relevantSetScores, selectedIds) {
  const bestSets = [...relevantSetScores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_RELEVANT_SETS)
    .map(([id]) => id);

  for (const setId of bestSets) {
    const best = profiles.find((profile) => profile.item?.setId === setId);
    if (best) selectedIds.add(best.item.id);
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

  const cap = Math.max(rule.count, SLOT_LIMITS[rule.id] || 24);
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
  reserveRelevantSetPieces(eligible, context.relevantSetScores, selectedIds);

  for (const profile of eligible) {
    if (selectedIds.size >= cap) break;
    selectedIds.add(profile.item.id);
  }

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
    relevantSetScores: null
  };
  context.relevantSetScores = buildRelevantSetScores(sets, context);

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

  return {
    items: output,
    diagnostics: {
      mode: targetElement ? 'mono-element' : 'multi-element',
      targetElement,
      apTarget: searchConstraints.ap || 0,
      before: items.length,
      after: output.length,
      relevantSets: context.relevantSetScores.size,
      slots
    }
  };
}
