import { SLOT_RULES } from '../js/config.js';
import { specialSlotRulesAreValid } from '../js/build-legality.js';
import { addStats } from '../js/stats.js';

const CORE_SLOTS = new Set(['hat', 'cape', 'amulet', 'ring', 'belt', 'boots', 'weapon', 'shield']);
const ELEMENT_TAG = { earth: 'terre', fire: 'feu', water: 'eau', air: 'air' };
const ELEMENTS = Object.keys(ELEMENT_TAG);
const RES_KEYS = ['resNeutral', 'resEarth', 'resFire', 'resWater', 'resAir'];

function num(stats, key) {
  const value = Number(stats?.[key] || 0);
  return Number.isFinite(value) ? value : 0;
}

function itemId(item) {
  return String(item?.id || '');
}

function combinations(values, size) {
  const output = [];
  const picked = [];
  function visit(start) {
    if (picked.length === size) {
      output.push([...picked]);
      return;
    }
    for (let i = start; i <= values.length - (size - picked.length); i++) {
      picked.push(values[i]);
      visit(i + 1);
      picked.pop();
    }
  }
  if (size > 0 && values.length >= size) visit(0);
  return output;
}

function occupiedSlots(items = []) {
  const output = {};
  for (const item of items) output[item.slot] = Number(output[item.slot] || 0) + 1;
  return output;
}

function slotSignature(slots = {}) {
  return Object.entries(slots).sort(([a], [b]) => a.localeCompare(b)).map(([slot, count]) => `${slot}:${count}`).join('|');
}

function aggregateItemStats(items = []) {
  const stats = {};
  for (const item of items) addStats(stats, item?.stats || {});
  return stats;
}

export function setBonusForPieceCount(set, pieceCount) {
  const value = set?.bonuses?.[String(pieceCount)] ?? set?.bonuses?.[pieceCount];
  return value && typeof value === 'object' ? { ...value } : {};
}

function conditionSignature(items = []) {
  return items
    .filter((item) => item?.conditions)
    .map((item) => JSON.stringify(item.conditions))
    .sort();
}

export function evaluateSetCoreLegality(items = [], { slotRules = SLOT_RULES } = {}) {
  const capacities = new Map((slotRules || SLOT_RULES).map((rule) => [rule.id, Number(rule.count || 0)]));
  const slots = occupiedSlots(items);
  const reasons = [];
  const ids = items.map(itemId);
  if (new Set(ids).size !== ids.length) reasons.push('duplicate-item');
  for (const [slot, count] of Object.entries(slots)) {
    if (!CORE_SLOTS.has(slot)) reasons.push(`unsupported-slot:${slot}`);
    if (count > Number(capacities.get(slot) || 0)) reasons.push(`slot-overflow:${slot}`);
  }
  if (!specialSlotRulesAreValid(items)) reasons.push('special-slot-rule');
  return {
    valid: reasons.length === 0,
    reasons,
    conditions: items.some((item) => item?.conditions) ? 'deferred-to-build-legality' : 'none',
    conditionSignature: conditionSignature(items)
  };
}

function profileScores(stats = {}, bonus = {}) {
  const scores = {};
  for (const element of ELEMENTS) {
    const damageKey = `damage${element[0].toUpperCase()}${element.slice(1)}`;
    scores[ELEMENT_TAG[element]] = Math.max(0, num(stats, element)) + Math.max(0, num(stats, 'power')) + Math.max(0, num(stats, damageKey)) * 6;
  }
  scores.multi = Math.max(0, num(stats, 'power')) * 2 + ELEMENTS.reduce((sum, key) => sum + Math.max(0, num(stats, key)), 0) / 2;
  scores.crit = Math.max(0, num(stats, 'crit')) * 15 + Math.max(0, num(stats, 'critDamage')) * 3;
  scores['do-crit'] = Math.max(0, num(stats, 'crit')) * 8 + Math.max(0, num(stats, 'critDamage')) * 6;
  scores.initiative = Math.max(0, num(stats, 'initiative')) / 8;
  scores.vita = Math.max(0, num(stats, 'vit')) / 3;
  scores.res = RES_KEYS.reduce((sum, key) => sum + Math.max(0, num(stats, key)) * 8, 0) + Math.max(0, num(stats, 'critResistance'));
  scores.melee = Math.max(0, num(stats, 'meleeDamagePct')) * 18 + Math.max(0, num(stats, 'power'));
  scores.distance = Math.max(0, num(stats, 'rangedDamagePct')) * 18 + Math.max(0, num(stats, 'power'));
  scores.PA = Math.max(0, num(stats, 'ap')) * 600 + Math.max(0, num(bonus, 'ap')) * 250;
  scores.PM = Math.max(0, num(stats, 'mp')) * 500 + Math.max(0, num(bonus, 'mp')) * 200;
  scores.PO = Math.max(0, num(stats, 'range')) * 300 + Math.max(0, num(bonus, 'range')) * 120;
  return scores;
}

export function profileSetCore(stats = {}, bonus = {}) {
  const raw = profileScores(stats, bonus);
  const max = Math.max(0, ...Object.values(raw));
  const profile = Object.fromEntries(Object.entries(raw).map(([tag, score]) => [tag, {
    score: Math.round(score * 1000) / 1000,
    tier: score <= 0 || max <= 0 ? 0 : score / max >= 0.72 ? 3 : score / max >= 0.38 ? 2 : 1
  }]));
  const tags = Object.entries(profile)
    .filter(([, value]) => value.tier > 0)
    .sort((a, b) => b[1].tier - a[1].tier || b[1].score - a[1].score)
    .slice(0, 6)
    .map(([tag]) => tag);
  return { profile, tags };
}

function whySelected(tags, bonus) {
  const labels = {
    terre: 'high earth damage', feu: 'high fire damage', eau: 'high water damage', air: 'high air damage', multi: 'multi-element value',
    crit: 'critical synergy', 'do-crit': 'critical-damage synergy', initiative: 'high initiative', vita: 'high vitality', res: 'defensive value',
    melee: 'melee synergy', distance: 'ranged synergy', PA: 'action-point value', PM: 'movement-point value', PO: 'range value'
  };
  const output = tags.slice(0, 3).map((tag) => labels[tag]).filter(Boolean);
  if (Object.values(bonus || {}).some((value) => Number(value || 0) !== 0)) output.push('useful set bonus');
  return [...new Set(output)].slice(0, 4);
}

function buildCore(set, items, pieceCount, slotRules) {
  const setBonuses = setBonusForPieceCount(set, pieceCount);
  const itemStats = aggregateItemStats(items);
  const aggregateStats = { ...itemStats };
  addStats(aggregateStats, setBonuses);
  const slots = occupiedSlots(items);
  const { profile, tags } = profileSetCore(aggregateStats, setBonuses);
  const ids = items.map(itemId).sort();
  return {
    id: `${set.id}:${pieceCount}:${ids.join('+')}`,
    setId: set.id,
    setName: set.name || set.id,
    items: ids,
    occupiedSlots: slots,
    pieceCount,
    setBonuses,
    itemStats,
    aggregateStats,
    tags,
    profile,
    legality: evaluateSetCoreLegality(items, { slotRules }),
    whySelected: whySelected(tags, setBonuses)
  };
}

function conditionsNoHarder(a, b) {
  if (a.legality.conditions === 'none') return true;
  return JSON.stringify(a.legality.conditionSignature) === JSON.stringify(b.legality.conditionSignature);
}

export function coreDominates(a, b) {
  if (!a?.legality?.valid || !b?.legality?.valid) return false;
  if (a.setId !== b.setId || a.pieceCount !== b.pieceCount || slotSignature(a.occupiedSlots) !== slotSignature(b.occupiedSlots)) return false;
  if (!conditionsNoHarder(a, b)) return false;
  const keys = new Set([...Object.keys(a.aggregateStats || {}), ...Object.keys(b.aggregateStats || {})]);
  let strict = false;
  for (const key of keys) {
    if (num(a.aggregateStats, key) < num(b.aggregateStats, key)) return false;
    if (num(a.aggregateStats, key) > num(b.aggregateStats, key)) strict = true;
  }
  return strict;
}

export function pruneDominatedSetCores(cores = []) {
  const legal = cores.filter((core) => core.legality.valid);
  const dominated = new Set();
  for (let i = 0; i < legal.length; i++) {
    if (dominated.has(legal[i].id)) continue;
    for (let j = 0; j < legal.length; j++) {
      if (i !== j && !dominated.has(legal[j].id) && coreDominates(legal[i], legal[j])) dominated.add(legal[j].id);
    }
  }
  return {
    cores: legal.filter((core) => !dominated.has(core.id)),
    illegalRemoved: cores.length - legal.length,
    dominatedRemoved: dominated.size,
    dominatedIds: [...dominated].sort()
  };
}

export function buildSetCoreCatalog({ items = [], sets = [], slotRules = SLOT_RULES, minPieceCount = 2, maxPieceCount = 4, pruneDominated = true } = {}) {
  const itemById = new Map(items.map((item) => [itemId(item), item]));
  const bySet = new Map();
  for (const item of items) {
    if (!item?.setId) continue;
    const key = String(item.setId);
    if (!bySet.has(key)) bySet.set(key, []);
    bySet.get(key).push(item);
  }
  const generated = [];
  let setsWithCores = 0;
  for (const set of sets) {
    if (!set?.id) continue;
    const explicit = (set.equipmentIds || []).map(String).map((id) => itemById.get(id)).filter(Boolean);
    const source = explicit.length ? explicit : (bySet.get(String(set.id)) || []);
    const members = [...new Map(source.filter((item) => CORE_SLOTS.has(item?.slot)).map((item) => [itemId(item), item])).values()];
    let countForSet = 0;
    for (const count of Object.keys(set.bonuses || {}).map(Number).filter((value) => Number.isInteger(value) && value >= minPieceCount && value <= maxPieceCount && value <= members.length).sort((a, b) => a - b)) {
      for (const combo of combinations(members, count)) {
        generated.push(buildCore(set, combo, count, slotRules));
        countForSet++;
      }
    }
    if (countForSet) setsWithCores++;
  }
  const pruned = pruneDominated ? pruneDominatedSetCores(generated) : {
    cores: generated.filter((core) => core.legality.valid),
    illegalRemoved: generated.filter((core) => !core.legality.valid).length,
    dominatedRemoved: 0,
    dominatedIds: []
  };
  return {
    cores: pruned.cores,
    diagnostics: {
      setsTotal: sets.length,
      setsWithCores,
      generated: generated.length,
      illegalRemoved: pruned.illegalRemoved,
      dominatedRemoved: pruned.dominatedRemoved,
      retained: pruned.cores.length
    }
  };
}

export function setCoresAreCompatible(a, b, { items = [], slotRules = SLOT_RULES } = {}) {
  if (!a || !b) return { compatible: false, reasons: ['missing-core'] };
  if ((a.items || []).some((id) => (b.items || []).includes(id))) return { compatible: false, reasons: ['shared-item'] };
  const itemById = new Map(items.map((item) => [itemId(item), item]));
  const merged = [...a.items, ...b.items].map((id) => itemById.get(String(id))).filter(Boolean);
  if (merged.length !== a.items.length + b.items.length) return { compatible: false, reasons: ['missing-item-data'] };
  const legality = evaluateSetCoreLegality(merged, { slotRules });
  return { compatible: legality.valid, reasons: legality.reasons, legality, sameSet: a.setId === b.setId };
}

export function scoreSetCoreForPolicy(core, policy) {
  const ranked = policy.rankStats(core.aggregateStats);
  const constraintKeys = Object.entries(policy.constraints || {}).filter(([, value]) => Number(value || 0) > 0).map(([key]) => key);
  const constraintSignal = constraintKeys.reduce((sum, key) => sum + Math.min(1, Math.max(0, num(core.aggregateStats, key)) / Math.max(1, Number(policy.constraints[key]))), 0);
  return {
    ...core,
    policyScore: ranked.rankScore + constraintSignal * policy.profile.ranking.constraintWeight,
    policyObjectiveGain: ranked.objectiveGain,
    policyConstraintSignal: constraintSignal
  };
}

export function selectRelevantSetCores(catalog, policy, limit = 10) {
  return (catalog?.cores || [])
    .map((core) => scoreSetCoreForPolicy(core, policy))
    .filter((core) => core.policyObjectiveGain > 0 || core.policyConstraintSignal > 0 || num(core.aggregateStats, 'ap') > 0 || num(core.aggregateStats, 'mp') > 0 || num(core.aggregateStats, 'range') > 0)
    .sort((a, b) => b.policyScore - a.policyScore || b.pieceCount - a.pieceCount || a.id.localeCompare(b.id))
    .slice(0, Math.max(0, Number(limit || 0)));
}

export function formatSetCoreDiagnostics(diagnostics = {}) {
  const eliminated = Number(diagnostics.illegalRemoved || 0) + Number(diagnostics.dominatedRemoved || 0);
  return [
    `${Number(diagnostics.setsTotal || 0)} panoplies`,
    `${Number(diagnostics.generated || 0)} cores générés`,
    `${eliminated} cores éliminés par dominance/légalité`,
    `${Number(diagnostics.relevant || 0)} pertinents pour l'objectif`,
    `${Number(diagnostics.injected || 0)} injectés dans la recherche`
  ].join('\n');
}
