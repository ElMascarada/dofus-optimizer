import { addStats, effectiveStat, emptyStats } from './stats.js';

const EFFECT_STAT_ALIASES = new Map([
  ['AP', 'ap'],
  ['Action Point', 'ap'],
  ['Action Points', 'ap'],
  ['MP', 'mp'],
  ['Movement Point', 'mp'],
  ['Movement Points', 'mp'],
  ['Range', 'range'],
  ['Vitality', 'vit'],
  ['Agility', 'air'],
  ['Chance', 'water'],
  ['Strength', 'earth'],
  ['Intelligence', 'fire'],
  ['Power', 'power'],
  ['Critical', 'crit'],
  ['Critical Hit', 'crit'],
  ['Critical Hits', 'crit'],
  ['Wisdom', 'wisdom'],
  ['AP Reduction', 'apReduction'],
  ['AP Parry', 'apParry'],
  ['MP Reduction', 'mpReduction'],
  ['MP Parry', 'mpParry'],
  ['Heals', 'heals'],
  ['Lock', 'lock'],
  ['Dodge', 'dodge'],
  ['Initiative', 'initiative'],
  ['Summons', 'summons'],
  ['Prospecting', 'prospecting'],
  ['Pods', 'pods'],
  ['Damage', 'damage'],
  ['Critical Damage', 'critDamage'],
  ['Neutral Damage', 'damageNeutral'],
  ['Earth Damage', 'damageEarth'],
  ['Fire Damage', 'damageFire'],
  ['Water Damage', 'damageWater'],
  ['Air Damage', 'damageAir'],
  ['Reflect', 'reflect'],
  ['Trap Damage', 'trapDamage'],
  ['Power (traps)', 'trapPower'],
  ['Trap Power', 'trapPower'],
  ['Pushback Damage', 'pushbackDamage'],
  ['% Spell Damage', 'spellDamagePct'],
  ['Spell Damage (%)', 'spellDamagePct'],
  ['% Weapon Damage', 'weaponDamagePct'],
  ['Weapon Damage (%)', 'weaponDamagePct'],
  ['% Ranged Damage', 'rangedDamagePct'],
  ['Ranged Damage (%)', 'rangedDamagePct'],
  ['% Melee Damage', 'meleeDamagePct'],
  ['Melee Damage (%)', 'meleeDamagePct'],
  ['Neutral Resistance', 'fixedResNeutral'],
  ['% Neutral Resistance', 'resNeutral'],
  ['Neutral Resistance (%)', 'resNeutral'],
  ['Earth Resistance', 'fixedResEarth'],
  ['% Earth Resistance', 'resEarth'],
  ['Earth Resistance (%)', 'resEarth'],
  ['Fire Resistance', 'fixedResFire'],
  ['% Fire Resistance', 'resFire'],
  ['Fire Resistance (%)', 'resFire'],
  ['Water Resistance', 'fixedResWater'],
  ['% Water Resistance', 'resWater'],
  ['Water Resistance (%)', 'resWater'],
  ['Air Resistance', 'fixedResAir'],
  ['% Air Resistance', 'resAir'],
  ['Air Resistance (%)', 'resAir'],
  ['Critical Resistance', 'critResistance'],
  ['Pushback Resistance', 'pushbackResistance'],
  ['% Ranged Resistance', 'rangedResistancePct'],
  ['Ranged Resistance (%)', 'rangedResistancePct'],
  ['% Melee Resistance', 'meleeResistancePct'],
  ['Melee Resistance (%)', 'meleeResistancePct']
]);

const CONDITION_STAT_ALIASES = new Map([
  ...EFFECT_STAT_ALIASES,
  ['Level', 'level'],
  ['Character Level', 'level']
]);

const SLOT_ALIASES = {
  hat: ['coiffe', 'chapeau', 'hat', 'headgear'],
  cape: ['cape', 'cloak'],
  amulet: ['amulette', 'amulet'],
  ring: ['anneau', 'ring'],
  belt: ['ceinture', 'belt'],
  boots: ['bottes', 'boots'],
  shield: ['bouclier', 'shield'],
  companion: ['familier', 'pet', 'montilier', 'petsmount', 'petmount', 'sidekick'],
  dofus: ['dofus', 'trophee', 'trophy']
};

const WEAPON_TYPE_WORDS = [
  'epee', 'sword', 'dague', 'dagger', 'hache', 'axe', 'marteau', 'hammer',
  'pelle', 'shovel', 'arc', 'bow', 'baguette', 'wand', 'baton', 'staff',
  'lance', 'spear', 'faux', 'scythe', 'pioche', 'pickaxe'
];

function normalizeText(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[’']/g, ' ')
    .replace(/[^a-z0-9%]+/g, ' ')
    .trim();
}

export function effectElementName(effect, elements = []) {
  const id = Number(effect?.type?.id);
  if (Number.isInteger(id) && typeof elements[id] === 'string' && elements[id]) return elements[id];
  if (typeof effect?.type?.name === 'string' && effect.type.name) return effect.type.name;
  return null;
}

export function conditionElementName(condition, elements = []) {
  const id = Number(condition?.element?.id);
  if (Number.isInteger(id) && typeof elements[id] === 'string' && elements[id]) return elements[id];
  if (typeof condition?.element?.name === 'string' && condition.element.name) return condition.element.name;
  return null;
}

function effectNumericValue(effect, valueMode = 'max') {
  if (effect?.ignore_int_min) return null;
  const min = Number(effect?.int_minimum);
  const max = Number(effect?.int_maximum);
  const hasMin = Number.isFinite(min);
  const hasMax = Number.isFinite(max) && !effect?.ignore_int_max;
  if (!hasMin && !hasMax) return null;
  if (valueMode === 'min' && hasMin) return min;
  if (valueMode === 'average' && hasMin && hasMax) return (min + max) / 2;
  if (valueMode === 'max' && hasMax) return max;
  return hasMin ? min : max;
}

function sourceRange(effect) {
  const min = Number(effect?.int_minimum);
  const max = Number(effect?.int_maximum);
  if (effect?.ignore_int_min || !Number.isFinite(min)) return null;
  if (effect?.ignore_int_max || !Number.isFinite(max)) return [min, min];
  return [min, max];
}

export function normalizeEffect(effect, elements = [], { valueMode = 'max' } = {}) {
  const name = effectElementName(effect, elements);
  const base = {
    name,
    effectTypeId: Number.isInteger(Number(effect?.type?.id)) ? Number(effect.type.id) : null,
    formatted: effect?.formatted || null,
    sourceRange: sourceRange(effect)
  };

  if (effect?.type?.is_active) return { ...base, status: 'active', reason: 'active-effect' };
  if (effect?.type?.is_meta) return { ...base, status: 'meta', reason: 'meta-effect' };
  if (!name) return { ...base, status: 'unmapped', reason: 'missing-effect-name' };

  const stat = EFFECT_STAT_ALIASES.get(name);
  if (!stat) return { ...base, status: 'unmapped', reason: 'unknown-effect-name' };

  const value = effectNumericValue(effect, valueMode);
  if (!Number.isFinite(value)) return { ...base, status: 'unmapped', reason: 'non-numeric-effect' };
  return { ...base, status: 'mapped', stat, value };
}

export function normalizeEffects(effects = [], elements = [], options = {}) {
  const stats = emptyStats();
  const details = [];
  for (const effect of Array.isArray(effects) ? effects : []) {
    const detail = normalizeEffect(effect, elements, options);
    details.push(detail);
    if (detail.status === 'mapped') addStats(stats, { [detail.stat]: detail.value });
  }
  const coverage = details.reduce((acc, detail) => {
    acc[detail.status] = (acc[detail.status] || 0) + 1;
    return acc;
  }, { mapped: 0, active: 0, meta: 0, unmapped: 0 });
  return { stats: { ...stats }, details, coverage, certified: coverage.unmapped === 0 && coverage.meta === 0 };
}

export function slotFromEquipment(item) {
  if (item?.is_weapon === true) return 'weapon';
  const typeName = normalizeText(item?.type?.name || '');
  if (!typeName) return null;
  for (const [slot, aliases] of Object.entries(SLOT_ALIASES)) {
    if (aliases.some((alias) => typeName === normalizeText(alias) || typeName.includes(normalizeText(alias)))) return slot;
  }
  if (WEAPON_TYPE_WORDS.some((word) => typeName.includes(word))) return 'weapon';
  return null;
}

function normalizeOperator(operator) {
  const raw = String(operator || '').trim().toLowerCase();
  const aliases = {
    '=': 'eq', '==': 'eq', '===': 'eq', eq: 'eq',
    '!=': 'neq', '<>': 'neq', neq: 'neq',
    '>': 'gt', gt: 'gt', '>=': 'gte', gte: 'gte',
    '<': 'lt', lt: 'lt', '<=': 'lte', lte: 'lte'
  };
  return aliases[raw] || null;
}

export function normalizeConditionNode(node, elements = []) {
  if (!node) return { status: 'none', node: null, unmapped: [] };
  const isOperand = node.is_operand ?? node.isOperand;
  if (isOperand === true || node.condition) {
    const condition = node.condition || {};
    const name = conditionElementName(condition, elements);
    const stat = name ? CONDITION_STAT_ALIASES.get(name) : null;
    const operator = normalizeOperator(condition.operator);
    const value = Number(condition.int_value ?? condition.intValue);
    if (!name || !stat || !operator || !Number.isFinite(value)) {
      return { status: 'unmapped', node: null, unmapped: [{ name, operator: condition.operator || null, value: Number.isFinite(value) ? value : null }] };
    }
    return { status: 'supported', node: { kind: 'condition', stat, operator, value, sourceName: name }, unmapped: [] };
  }
  const relation = String(node.relation || '').toLowerCase();
  if ((isOperand === false || Array.isArray(node.children)) && (relation === 'and' || relation === 'or')) {
    const children = [];
    const unmapped = [];
    let supported = true;
    for (const child of node.children || []) {
      if (!child) continue;
      const normalized = normalizeConditionNode(child, elements);
      if (normalized.node) children.push(normalized.node);
      if (normalized.status === 'unmapped') supported = false;
      unmapped.push(...(normalized.unmapped || []));
    }
    return { status: supported ? 'supported' : 'unmapped', node: supported ? { kind: 'relation', relation, children } : null, unmapped };
  }
  return { status: 'unmapped', node: null, unmapped: [{ reason: 'unknown-condition-shape' }] };
}

export function evaluateCondition(node, stats = {}) {
  if (!node) return true;
  if (node.kind === 'relation') {
    if (node.relation === 'and') return node.children.every((child) => evaluateCondition(child, stats));
    if (node.relation === 'or') return node.children.some((child) => evaluateCondition(child, stats));
    return false;
  }
  const actual = effectiveStat(stats, node.stat);
  if (node.operator === 'eq') return actual === node.value;
  if (node.operator === 'neq') return actual !== node.value;
  if (node.operator === 'gt') return actual > node.value;
  if (node.operator === 'gte') return actual >= node.value;
  if (node.operator === 'lt') return actual < node.value;
  if (node.operator === 'lte') return actual <= node.value;
  return false;
}

export function normalizeEquipmentItem(item, elements = [], options = {}) {
  const slot = slotFromEquipment(item);
  const effects = normalizeEffects(item?.effects, elements, options);
  const conditions = normalizeConditionNode(item?.conditions, elements);
  const setId = item?.parent_set?.id ?? item?.parentSet?.id ?? null;
  const id = item?.ankama_id ?? item?.ankamaId;
  return {
    id: `item-${id}`,
    ankamaId: id,
    name: item?.name || `Item ${id}`,
    level: Number(item?.level || 0),
    slot,
    typeId: item?.type?.id ?? null,
    typeName: item?.type?.name ?? null,
    setId: setId == null ? null : `set-${setId}`,
    imageUrl: item?.image_urls?.icon ?? item?.imageUrls?.icon ?? null,
    stats: effects.stats,
    conditions: conditions.node,
    conditionStatus: conditions.status,
    certification: {
      slotKnown: Boolean(slot),
      effectsCertified: effects.certified,
      conditionsCertified: conditions.status !== 'unmapped',
      certified: Boolean(slot) && effects.certified && conditions.status !== 'unmapped'
    },
    source: { effects: effects.details, unmappedConditions: conditions.unmapped }
  };
}

export function normalizeMount(mount, elements = [], options = {}) {
  const effects = normalizeEffects(mount?.effects, elements, options);
  const id = mount?.ankama_id ?? mount?.ankamaId;
  return {
    id: `mount-${id}`,
    ankamaId: id,
    name: mount?.name || `Mount ${id}`,
    level: 200,
    slot: 'companion',
    typeId: mount?.family?.ankama_id ?? mount?.family?.ankamaId ?? null,
    typeName: mount?.family?.name ?? 'Mount',
    setId: null,
    imageUrl: mount?.image_urls?.icon ?? mount?.imageUrls?.icon ?? null,
    stats: effects.stats,
    conditions: null,
    conditionStatus: 'none',
    certification: { slotKnown: true, effectsCertified: effects.certified, conditionsCertified: true, certified: effects.certified },
    source: { effects: effects.details, unmappedConditions: [] }
  };
}

export function shouldIncludeEquipment(item) {
  if (!item?.slot) return false;
  if (item.slot === 'dofus' || item.slot === 'companion') return true;
  return Number(item.level) >= 190;
}

export function normalizeSet(set, elements = [], options = {}) {
  const id = set?.ankama_id ?? set?.ankamaId;
  const bonuses = {};
  const coverage = [];
  const rawEffects = set?.effects || {};
  for (const [count, effects] of Object.entries(rawEffects)) {
    const normalized = normalizeEffects(effects, elements, options);
    bonuses[String(count)] = normalized.stats;
    coverage.push({ count: Number(count), ...normalized.coverage, certified: normalized.certified });
  }
  return {
    id: `set-${id}`,
    ankamaId: id,
    name: set?.name || `Set ${id}`,
    bonuses,
    equipmentIds: (set?.equipment_ids || set?.equipmentIds || []).map((itemId) => `item-${itemId}`),
    certification: { certified: coverage.every((entry) => entry.certified), coverage }
  };
}

export function buildCoverageReport({ items = [], sets = [], elements = [], version = {} }) {
  const unknownEffectNames = {};
  const unknownConditionNames = {};
  let certified = 0;
  let unknownSlot = 0;
  let unmappedEffects = 0;
  let activeEffects = 0;
  let metaEffects = 0;
  let unmappedConditions = 0;
  const bySlot = {};

  for (const item of items) {
    if (item.certification?.certified) certified++;
    if (!item.slot) unknownSlot++;
    bySlot[item.slot || 'unknown'] = (bySlot[item.slot || 'unknown'] || 0) + 1;
    for (const effect of item.source?.effects || []) {
      if (effect.status === 'unmapped') {
        unmappedEffects++;
        const key = effect.name || effect.reason || 'UNKNOWN';
        unknownEffectNames[key] = (unknownEffectNames[key] || 0) + 1;
      } else if (effect.status === 'active') activeEffects++;
      else if (effect.status === 'meta') metaEffects++;
    }
    for (const condition of item.source?.unmappedConditions || []) {
      unmappedConditions++;
      const key = condition.name || condition.reason || 'UNKNOWN';
      unknownConditionNames[key] = (unknownConditionNames[key] || 0) + 1;
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    version,
    elements: elements.length,
    items: {
      total: items.length,
      certified,
      unknownSlot,
      unmappedEffects,
      activeEffects,
      metaEffects,
      unmappedConditions,
      bySlot,
      unknownEffectNames,
      unknownConditionNames,
      certifiedPct: items.length ? Math.round((certified / items.length) * 10000) / 100 : 100
    },
    sets: {
      total: sets.length,
      certified: sets.filter((set) => set.certification?.certified).length,
      uncertifiedNames: sets.filter((set) => !set.certification?.certified).map((set) => set.name)
    }
  };
}
