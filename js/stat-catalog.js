export const WORKSHOP_STAT_SECTIONS = Object.freeze([
  {
    id: 'resources',
    label: 'Ressources / mobilité',
    stats: [
      { key: 'hp', sourceKey: 'vit', label: 'PV' },
      { key: 'ap', label: 'PA' },
      { key: 'mp', label: 'PM' },
      { key: 'range', label: 'PO' },
      { key: 'initiative', label: 'Initiative' }
    ]
  },
  {
    id: 'characteristics',
    label: 'Caractéristiques',
    stats: [
      { key: 'vit', label: 'Vitalité' },
      { key: 'wisdom', label: 'Sagesse' },
      { key: 'earth', label: 'Force' },
      { key: 'fire', label: 'Intelligence' },
      { key: 'water', label: 'Chance' },
      { key: 'air', label: 'Agilité' },
      { key: 'power', label: 'Puissance' }
    ]
  },
  {
    id: 'offense',
    label: 'Offensif',
    stats: [
      { key: 'crit', label: 'Critique', percent: true },
      { key: 'critDamage', label: 'Do Crit' },
      { key: 'damage', label: 'Dommages' },
      { key: 'damageNeutral', label: 'Do Neutre' },
      { key: 'damageEarth', label: 'Do Terre' },
      { key: 'damageFire', label: 'Do Feu' },
      { key: 'damageWater', label: 'Do Eau' },
      { key: 'damageAir', label: 'Do Air' },
      { key: 'spellDamagePct', label: '% Do Sorts', percent: true },
      { key: 'weaponDamagePct', label: '% Do Armes', percent: true },
      { key: 'meleeDamagePct', label: '% Do Mêlée', percent: true },
      { key: 'rangedDamagePct', label: '% Do Distance', percent: true },
      { key: 'finalDamagePct', label: '% Do Finaux', percent: true }
    ]
  },
  {
    id: 'defense',
    label: 'Défensif / mobilité',
    stats: [
      { key: 'dodge', label: 'Fuite' },
      { key: 'lock', label: 'Tacle' },
      { key: 'apParry', label: 'Esquive PA' },
      { key: 'mpParry', label: 'Esquive PM' },
      { key: 'apReduction', label: 'Retrait PA' },
      { key: 'mpReduction', label: 'Retrait PM' }
    ]
  },
  {
    id: 'resistances',
    label: 'Résistances',
    stats: [
      { key: 'fixedResNeutral', label: 'Ré Neutre' },
      { key: 'fixedResEarth', label: 'Ré Terre' },
      { key: 'fixedResFire', label: 'Ré Feu' },
      { key: 'fixedResWater', label: 'Ré Eau' },
      { key: 'fixedResAir', label: 'Ré Air' },
      { key: 'resNeutral', label: '% Ré Neutre', percent: true },
      { key: 'resEarth', label: '% Ré Terre', percent: true },
      { key: 'resFire', label: '% Ré Feu', percent: true },
      { key: 'resWater', label: '% Ré Eau', percent: true },
      { key: 'resAir', label: '% Ré Air', percent: true },
      { key: 'critResistance', label: 'Ré Critique' },
      { key: 'pushbackResistance', label: 'Ré Poussée' },
      { key: 'meleeResistancePct', label: '% Ré Mêlée', percent: true },
      { key: 'rangedResistancePct', label: '% Ré Distance', percent: true },
      { key: 'weaponResistancePct', label: '% Ré Armes', percent: true }
    ]
  }
]);

export const STAT_DEFINITIONS = Object.freeze(
  WORKSHOP_STAT_SECTIONS.flatMap((section) => section.stats.map((entry) => Object.freeze({ ...entry, section: section.id })))
);

export const STAT_DEFINITION_BY_KEY = Object.freeze(
  Object.fromEntries(STAT_DEFINITIONS.map((definition) => [definition.key, definition]))
);

export const MIN_CONDITION_STATS = Object.freeze(
  STAT_DEFINITIONS
    .filter((definition) => definition.key !== 'hp')
    .map((definition) => Object.freeze({
      key: definition.key,
      label: definition.label,
      percent: Boolean(definition.percent)
    }))
);

export const MIN_CONDITION_KEYS = Object.freeze(MIN_CONDITION_STATS.map(({ key }) => key));

export function statDisplayValue(stats = {}, definition = {}) {
  const key = definition.sourceKey || definition.key;
  return Number(stats?.[key] || 0);
}
