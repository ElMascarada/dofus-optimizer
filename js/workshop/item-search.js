const ELEMENT_STATS = Object.freeze({
  earth: ['earth', 'damageEarth'],
  fire: ['fire', 'damageFire'],
  water: ['water', 'damageWater'],
  air: ['air', 'damageAir']
});

const RESISTANCE_STATS = Object.freeze(['resNeutral', 'resEarth', 'resFire', 'resWater', 'resAir']);

const SLOT_TERMS = Object.freeze({
  coiffe: 'hat', chapeau: 'hat', hat: 'hat',
  cape: 'cape',
  amulette: 'amulet', amu: 'amulet', amulet: 'amulet',
  anneau: 'ring', anneaux: 'ring', ring: 'ring',
  ceinture: 'belt', belt: 'belt',
  bottes: 'boots', botte: 'boots', boots: 'boots',
  arme: 'weapon', weapon: 'weapon',
  bouclier: 'shield', shield: 'shield',
  familier: 'companion', monture: 'companion', compagnon: 'companion', companion: 'companion',
  dofus: 'dofus', trophee: 'dofus', trophees: 'dofus', prysmaradite: 'dofus', prysma: 'dofus'
});

const TERM_ALIASES = Object.freeze({
  terre: 'earth', force: 'earth', earth: 'earth',
  feu: 'fire', intel: 'fire', intelligence: 'fire', fire: 'fire',
  eau: 'water', chance: 'water', water: 'water',
  air: 'air', agi: 'air', agilite: 'air',
  multi: 'multi', puissance: 'multi', power: 'multi',
  ini: 'initiative', initiative: 'initiative',
  vita: 'vitality', vitalite: 'vitality', vie: 'vitality',
  res: 'resistance', resist: 'resistance', resistance: 'resistance', resistances: 'resistance',
  distance: 'ranged', distant: 'ranged', ranged: 'ranged',
  melee: 'melee', cac: 'melee',
  pa: 'ap', ap: 'ap',
  pm: 'mp', mp: 'mp',
  po: 'range', portee: 'range', range: 'range',
  crit: 'crit', critique: 'crit', critiques: 'crit',
  dommages: 'damage', dommage: 'damage', damage: 'damage', degats: 'damage',
  gros: 'magnitude', grosse: 'magnitude', grosses: 'magnitude', grande: 'magnitude', beaucoup: 'magnitude'
});

const CRITERION_LABELS = Object.freeze({
  earth: 'Terre', fire: 'Feu', water: 'Eau', air: 'Air', multi: 'Multi',
  initiative: 'Initiative', vitality: 'Vitalité', resistance: 'Résistances',
  ranged: 'Distance', melee: 'Mêlée', ap: 'PA', mp: 'PM', range: 'PO',
  crit: 'Critique', 'crit-damage': 'Do Crit', damage: 'Dommages'
});

export function normalizeItemSearchText(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9%+-]+/g, ' ')
    .trim();
}

function number(stats, key) {
  const value = Number(stats?.[key] || 0);
  return Number.isFinite(value) ? value : 0;
}

function metricBundle(item = {}) {
  const stats = item.stats || {};
  const elements = Object.fromEntries(Object.entries(ELEMENT_STATS).map(([element, [stat, damage]]) => [element, {
    stat: number(stats, stat),
    damage: number(stats, damage)
  }]));
  const power = number(stats, 'power');
  const elementCount = Object.values(elements).filter((value) => value.stat > 0 || value.damage > 0).length;
  const resistanceValues = RESISTANCE_STATS.map((key) => number(stats, key));
  return {
    elements,
    power,
    elementCount,
    crit: number(stats, 'crit'),
    critDamage: number(stats, 'critDamage'),
    initiative: number(stats, 'initiative'),
    vitality: number(stats, 'vit'),
    resistanceTotal: resistanceValues.reduce((sum, value) => sum + Math.max(0, value), 0),
    resistanceMax: Math.max(0, ...resistanceValues),
    ranged: number(stats, 'rangedDamagePct'),
    melee: number(stats, 'meleeDamagePct'),
    ap: number(stats, 'ap'),
    mp: number(stats, 'mp'),
    range: number(stats, 'range'),
    damage: number(stats, 'damage'),
    elementalDamage: Object.values(elements).reduce((sum, value) => sum + Math.max(0, value.damage), 0)
  };
}

function criterionSignal(metrics, criterion) {
  if (ELEMENT_STATS[criterion]) {
    const element = metrics.elements[criterion];
    return Math.max(0, element.stat) + Math.max(0, metrics.power) * 0.8 + Math.max(0, element.damage) * 7;
  }
  if (criterion === 'multi') {
    const elementStats = Object.values(metrics.elements).map((entry) => Math.max(0, entry.stat)).sort((a, b) => b - a);
    return Math.max(0, metrics.power) * 2 + (elementStats[1] || 0) + (elementStats[2] || 0) * 0.5
      + Math.max(0, metrics.elementalDamage) * 2;
  }
  if (criterion === 'initiative') return Math.max(0, metrics.initiative) / 5;
  if (criterion === 'vitality') return Math.max(0, metrics.vitality) / 2;
  if (criterion === 'resistance') return Math.max(0, metrics.resistanceTotal) * 5;
  if (criterion === 'ranged') return Math.max(0, metrics.ranged) * 10;
  if (criterion === 'melee') return Math.max(0, metrics.melee) * 10;
  if (criterion === 'ap') return Math.max(0, metrics.ap) * 500;
  if (criterion === 'mp') return Math.max(0, metrics.mp) * 500;
  if (criterion === 'range') return Math.max(0, metrics.range) * 300;
  if (criterion === 'crit') return Math.max(0, metrics.crit) * 12;
  if (criterion === 'crit-damage') return Math.max(0, metrics.critDamage) * 9;
  if (criterion === 'damage') return Math.max(0, metrics.damage) * 8 + Math.max(0, metrics.elementalDamage) * 2;
  return 0;
}

function criterionReason(metrics, criterion) {
  if (ELEMENT_STATS[criterion]) {
    const element = metrics.elements[criterion];
    const parts = [];
    if (element.stat) parts.push(`${element.stat} ${CRITERION_LABELS[criterion]}`);
    if (metrics.power) parts.push(`${metrics.power} Puissance`);
    if (element.damage) parts.push(`${element.damage} Do ${CRITERION_LABELS[criterion]}`);
    return parts.join(' · ');
  }
  if (criterion === 'multi') {
    const parts = [];
    if (metrics.power) parts.push(`${metrics.power} Puissance`);
    if (metrics.elementCount >= 2) parts.push(`${metrics.elementCount} éléments`);
    if (metrics.elementalDamage) parts.push(`${metrics.elementalDamage} Do élémentaires`);
    return parts.join(' · ') || 'Profil multi';
  }
  if (criterion === 'initiative') return `${metrics.initiative} Initiative`;
  if (criterion === 'vitality') return `${metrics.vitality} Vitalité`;
  if (criterion === 'resistance') return `${metrics.resistanceTotal}% résistances cumulées`;
  if (criterion === 'ranged') return `${metrics.ranged}% dommages distance`;
  if (criterion === 'melee') return `${metrics.melee}% dommages mêlée`;
  if (criterion === 'ap') return `+${metrics.ap} PA`;
  if (criterion === 'mp') return `+${metrics.mp} PM`;
  if (criterion === 'range') return `+${metrics.range} PO`;
  if (criterion === 'crit') return `${metrics.crit}% Critique`;
  if (criterion === 'crit-damage') return `${metrics.critDamage} Do Crit`;
  if (criterion === 'damage') return `${metrics.damage + metrics.elementalDamage} dommages fixes/élémentaires`;
  return CRITERION_LABELS[criterion] || criterion;
}

export function parseSmartItemQuery(query = '') {
  const normalized = normalizeItemSearchText(query);
  const rawTokens = normalized ? normalized.split(/\s+/).filter(Boolean) : [];
  const tokens = [...rawTokens];
  const criteria = [];
  const freeText = [];
  let slot = null;
  let magnitude = false;

  const doIndex = tokens.findIndex((token, index) => ['do', 'dommage', 'dommages', 'damage', 'degats'].includes(token)
    && ['crit', 'critique', 'critiques'].includes(tokens[index + 1]));
  if (doIndex >= 0) {
    criteria.push('crit-damage');
    tokens.splice(doIndex, 2);
  }

  for (const token of tokens) {
    const slotMatch = SLOT_TERMS[token];
    if (slotMatch) {
      slot = slotMatch;
      continue;
    }
    const alias = TERM_ALIASES[token];
    if (alias === 'magnitude') {
      magnitude = true;
      continue;
    }
    if (alias) {
      if (alias === 'crit' && criteria.includes('crit-damage')) continue;
      if (!criteria.includes(alias)) criteria.push(alias);
      continue;
    }
    if (token !== 'do') freeText.push(token);
  }

  return { normalized, slot, criteria, freeText, magnitude };
}

function entryFor(item, setNames) {
  const setName = item.setId ? setNames.get(String(item.setId)) || '' : '';
  return {
    item,
    slot: item.slot,
    name: normalizeItemSearchText(item.name),
    setName: normalizeItemSearchText(setName),
    metrics: metricBundle(item)
  };
}

function scoreEntry(entry, plan) {
  if (plan.slot && entry.slot !== plan.slot) return null;
  let score = 0;
  const reasons = [];
  const tags = [];

  for (const criterion of plan.criteria) {
    const signal = criterionSignal(entry.metrics, criterion);
    if (!(signal > 0)) return null;
    const weighted = Math.min(650, signal);
    score += 300 + weighted * (plan.magnitude ? 1.25 : 1);
    reasons.push(criterionReason(entry.metrics, criterion));
    tags.push(CRITERION_LABELS[criterion] || criterion);
  }

  for (const token of plan.freeText) {
    const inName = entry.name.includes(token);
    const inSet = entry.setName.includes(token);
    if (!inName && !inSet) return null;
    score += inName ? 220 : 120;
    reasons.push(inName ? `Nom: ${entry.item.name}` : 'Panoplie correspondante');
  }

  if (plan.normalized && entry.name === plan.normalized) score += 1500;
  else if (plan.normalized && entry.name.includes(plan.normalized)) score += 700;

  // Stable tie-break signal: high-level items first without allowing level to
  // override a semantic mismatch (all semantic criteria are hard matches above).
  score += Math.max(0, Number(entry.item.level || 0)) / 1000;
  return { score, reasons: [...new Set(reasons)], tags: [...new Set(tags)] };
}

export function createItemSearchIndex(items = [], sets = []) {
  const setNames = new Map((sets || []).map((set) => [String(set.id), String(set.name || '')]));
  const entries = (items || []).map((item) => entryFor(item, setNames));
  const bySlot = new Map();
  for (const entry of entries) {
    if (!bySlot.has(entry.slot)) bySlot.set(entry.slot, []);
    bySlot.get(entry.slot).push(entry);
  }

  return {
    size: entries.length,
    search(query = '', { slot = null, limit = 120 } = {}) {
      const plan = parseSmartItemQuery(query);
      const effectiveSlot = slot || plan.slot || null;
      const pool = effectiveSlot ? (bySlot.get(effectiveSlot) || []) : entries;
      const matches = [];
      for (const entry of pool) {
        const scored = scoreEntry(entry, { ...plan, slot: effectiveSlot });
        if (!scored) continue;
        matches.push({ item: entry.item, ...scored });
      }
      matches.sort((a, b) => b.score - a.score
        || Number(b.item.level || 0) - Number(a.item.level || 0)
        || String(a.item.name).localeCompare(String(b.item.name), 'fr'));
      return {
        plan: { ...plan, slot: effectiveSlot },
        total: matches.length,
        results: matches.slice(0, Math.max(0, Number(limit || 0)))
      };
    }
  };
}
