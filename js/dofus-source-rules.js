import {
  conditionElementName,
  normalizeConditionNode,
  normalizeEquipmentItem,
  normalizeMount,
  normalizeSet
} from './dofusdude-normalizer.js';
import { extractKnownItemPassives } from './dofus-passives.js';

const ELEMENT_ALIASES = new Map([
  ['% Critical', 'Critical'],
  ['Heal', 'Heals'],
  ['Pod', 'Pods'],
  ['reflected damage', 'Reflect']
]);

const IGNORED_EFFECT_NAMES = new Set([
  'Exchangeable:',
  'Exchangeable::',
  'Title:',
  'Emote',
  'Hunting weapon',
  'Linked to the character',
  '/'
].map(normalizedText));

function normalizedText(value = '') {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/\s+/g, ' ');
}

export function patchedElements(elements = []) {
  return elements.map((name) => ELEMENT_ALIASES.get(name) || name);
}

function effectName(effect, elements = []) {
  const id = Number(effect?.type?.id);
  if (Number.isInteger(id) && typeof elements[id] === 'string') return elements[id];
  return effect?.type?.name || null;
}

export function filterNonCombatMetadata(effects = [], elements = []) {
  const kept = [];
  const ignored = [];
  for (const effect of Array.isArray(effects) ? effects : []) {
    if (IGNORED_EFFECT_NAMES.has(normalizedText(effectName(effect, elements)))) ignored.push(effect);
    else kept.push(effect);
  }
  return { kept, ignored };
}

export function normalizeSourceCondition(node, elements = []) {
  if (!node) return { status: 'none', node: null, unmapped: [] };
  const isOperand = node.is_operand ?? node.isOperand;
  if (isOperand === true || node.condition) {
    const condition = node.condition || {};
    const name = conditionElementName(condition, elements);
    if (name === 'Set bonus') {
      const operatorMap = { '<': 'lt', '<=': 'lte', '>': 'gt', '>=': 'gte', '=': 'eq', '==': 'eq', '!=': 'neq' };
      const operator = operatorMap[String(condition.operator || '').trim()] || null;
      const value = Number(condition.int_value ?? condition.intValue);
      if (!operator || !Number.isFinite(value)) {
        return { status: 'unmapped', node: null, unmapped: [{ name, operator: condition.operator || null, value }] };
      }
      return { status: 'supported', node: { kind: 'condition', stat: 'setBonus', operator, value, sourceName: name }, unmapped: [] };
    }
    return normalizeConditionNode(node, patchedElements(elements));
  }

  const relation = String(node.relation || '').toLowerCase();
  if ((isOperand === false || Array.isArray(node.children)) && (relation === 'and' || relation === 'or')) {
    const children = [];
    const unmapped = [];
    let supported = true;
    for (const child of node.children || []) {
      if (!child) continue;
      const normalized = normalizeSourceCondition(child, elements);
      if (normalized.node) children.push(normalized.node);
      if (normalized.status === 'unmapped') supported = false;
      unmapped.push(...(normalized.unmapped || []));
    }
    return { status: supported ? 'supported' : 'unmapped', node: supported ? { kind: 'relation', relation, children } : null, unmapped };
  }

  return { status: 'unmapped', node: null, unmapped: [{ reason: 'unknown-condition-shape' }] };
}

function finalizeNonWeaponDynamicCertification(item) {
  const dynamicEffects = (item.source?.effects || []).filter((effect) => effect.status === 'active' || effect.status === 'meta');
  if (item.slot !== 'weapon' && dynamicEffects.length > 0) {
    item.certification.effectsCertified = false;
    item.certification.certified = false;
    item.certification.temporalEffectsPending = true;
    item.source.pendingDynamicEffects = dynamicEffects.map((effect) => ({
      status: effect.status,
      name: effect.name || null,
      formatted: effect.formatted || null,
      reason: effect.reason || null
    }));
  } else {
    item.source.pendingDynamicEffects = [];
  }
  return item;
}

export function normalizeSourceEquipment(rawItem, elements = [], options = {}) {
  const filtered = filterNonCombatMetadata(rawItem?.effects, elements);
  const passiveExtraction = extractKnownItemPassives(rawItem, filtered.kept, elements);
  const patchedRaw = { ...rawItem, effects: passiveExtraction.kept };
  const item = normalizeEquipmentItem(patchedRaw, patchedElements(elements), options);
  const typeName = rawItem?.type?.name ?? item.typeName;
  if (!item.slot && normalizedText(typeName).includes('prysmaradite')) item.slot = 'dofus';
  item.typeName = typeName;
  item.slotSubtype = normalizedText(typeName).includes('prysmaradite') ? 'prysmaradite' : null;
  const conditionResult = normalizeSourceCondition(rawItem?.conditions, elements);
  item.conditions = conditionResult.node;
  item.conditionStatus = conditionResult.status;
  item.certification.slotKnown = Boolean(item.slot);
  item.certification.conditionsCertified = conditionResult.status !== 'unmapped';
  item.certification.certified = Boolean(item.slot) && item.certification.effectsCertified && item.certification.conditionsCertified;
  item.passives = passiveExtraction.passives;
  item.source.ignoredEffects = filtered.ignored.map((effect) => ({ name: effectName(effect, elements), formatted: effect.formatted || null }));
  item.source.recognizedPassiveEffects = passiveExtraction.consumed;
  item.source.unmappedConditions = conditionResult.unmapped;
  return finalizeNonWeaponDynamicCertification(item);
}

export function normalizeSourceMount(rawMount, elements = [], options = {}) {
  const filtered = filterNonCombatMetadata(rawMount?.effects, elements);
  const mount = normalizeMount({ ...rawMount, effects: filtered.kept }, patchedElements(elements), options);
  mount.source.ignoredEffects = filtered.ignored.map((effect) => ({ name: effectName(effect, elements), formatted: effect.formatted || null }));
  return finalizeNonWeaponDynamicCertification(mount);
}

export function normalizeSourceSet(rawSet, elements = [], options = {}) {
  const rawEffects = rawSet?.effects || {};
  const effects = {};
  let ignoredCount = 0;
  for (const [count, lines] of Object.entries(rawEffects)) {
    const filtered = filterNonCombatMetadata(lines, elements);
    effects[count] = filtered.kept;
    ignoredCount += filtered.ignored.length;
  }
  const set = normalizeSet({ ...rawSet, effects }, patchedElements(elements), options);
  set.source = { ignoredEffects: ignoredCount };
  return set;
}
