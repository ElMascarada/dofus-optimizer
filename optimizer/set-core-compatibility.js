import { SLOT_RULES } from '../js/config.js';
import { evaluateSetCoreLegality } from './set-core-catalog.js';

function itemId(item) {
  return String(item?.id || '');
}

function boundsForConditions(items = []) {
  const bounds = new Map();
  let deferred = false;

  function apply(node) {
    if (!node) return;
    if (node.kind === 'relation') {
      if (node.relation !== 'and') {
        deferred = true;
        return;
      }
      for (const child of node.children || []) apply(child);
      return;
    }

    const stat = String(node.stat || '');
    const value = Number(node.value);
    if (!stat || !Number.isFinite(value)) {
      deferred = true;
      return;
    }
    const entry = bounds.get(stat) || { min: -Infinity, max: Infinity, excluded: new Set() };
    if (node.operator === 'gt') entry.min = Math.max(entry.min, value + Number.EPSILON);
    else if (node.operator === 'gte') entry.min = Math.max(entry.min, value);
    else if (node.operator === 'lt') entry.max = Math.min(entry.max, value - Number.EPSILON);
    else if (node.operator === 'lte') entry.max = Math.min(entry.max, value);
    else if (node.operator === 'eq') {
      entry.min = Math.max(entry.min, value);
      entry.max = Math.min(entry.max, value);
    } else if (node.operator === 'neq') entry.excluded.add(value);
    else deferred = true;
    bounds.set(stat, entry);
  }

  for (const item of items) apply(item?.conditions);

  const conflicts = [];
  for (const [stat, entry] of bounds) {
    if (entry.min > entry.max) conflicts.push(stat);
    else if (entry.min === entry.max && entry.excluded.has(entry.min)) conflicts.push(stat);
  }
  return {
    status: conflicts.length ? 'incompatible' : deferred ? 'deferred' : 'compatible',
    conflicts,
    bounds: Object.fromEntries([...bounds.entries()].map(([stat, entry]) => [stat, {
      min: Number.isFinite(entry.min) ? entry.min : null,
      max: Number.isFinite(entry.max) ? entry.max : null,
      excluded: [...entry.excluded].sort((a, b) => a - b)
    }]))
  };
}

function setRuleCompatibility(a, b, sets = []) {
  if (a.setId !== b.setId) return { status: 'compatible', sameSet: false };
  const set = sets.find((entry) => String(entry.id) === String(a.setId));
  if (!set) return { status: 'deferred', sameSet: true, reason: 'missing-set-data' };
  const combined = new Set([...(a.items || []), ...(b.items || [])].map(String));
  const available = new Set((set.equipmentIds || []).map(String));
  if ([...combined].some((id) => !available.has(id))) {
    return { status: 'incompatible', sameSet: true, reason: 'item-not-in-set' };
  }
  if (combined.size > available.size) {
    return { status: 'incompatible', sameSet: true, reason: 'set-piece-overflow' };
  }
  return { status: 'compatible', sameSet: true, combinedPieces: combined.size };
}

export function analyzeSetCoreCompatibility(a, b, { items = [], sets = [], slotRules = SLOT_RULES } = {}) {
  if (!a || !b) return { compatible: false, reasons: ['missing-core'], slots: 'incompatible', conditions: 'deferred', setRules: 'deferred' };
  const shared = (a.items || []).filter((id) => (b.items || []).map(String).includes(String(id)));
  if (shared.length) return { compatible: false, reasons: ['shared-item'], slots: 'incompatible', conditions: 'compatible', setRules: 'compatible' };

  const byId = new Map(items.map((item) => [itemId(item), item]));
  const merged = [...a.items, ...b.items].map((id) => byId.get(String(id))).filter(Boolean);
  if (merged.length !== (a.items?.length || 0) + (b.items?.length || 0)) {
    return { compatible: null, reasons: ['missing-item-data'], slots: 'deferred', conditions: 'deferred', setRules: 'deferred' };
  }

  const legality = evaluateSetCoreLegality(merged, { slotRules });
  const conditionInfo = boundsForConditions(merged);
  const setRuleInfo = setRuleCompatibility(a, b, sets);
  const reasons = [...legality.reasons];
  for (const stat of conditionInfo.conflicts) reasons.push(`condition-conflict:${stat}`);
  if (setRuleInfo.status === 'incompatible') reasons.push(`set-rule:${setRuleInfo.reason}`);

  const hardInvalid = reasons.length > 0;
  const deferred = conditionInfo.status === 'deferred' || setRuleInfo.status === 'deferred';
  return {
    compatible: hardInvalid ? false : deferred ? null : true,
    reasons,
    slots: legality.valid ? 'compatible' : 'incompatible',
    conditions: conditionInfo.status,
    conditionInfo,
    setRules: setRuleInfo.status,
    setRuleInfo
  };
}
