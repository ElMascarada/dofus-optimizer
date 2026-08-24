export const APP_VERSION = '0.13.2';

export const ELEMENTS = ['earth', 'fire', 'water', 'air'];

export const SLOT_RULES = [
  { id: 'hat', label: 'Coiffe', count: 1 },
  { id: 'cape', label: 'Cape', count: 1 },
  { id: 'amulet', label: 'Amulette', count: 1 },
  { id: 'ring', label: 'Anneaux', count: 2 },
  { id: 'belt', label: 'Ceinture', count: 1 },
  { id: 'boots', label: 'Bottes', count: 1 },
  { id: 'weapon', label: 'Arme', count: 1 },
  { id: 'shield', label: 'Bouclier', count: 1 },
  { id: 'companion', label: 'Familier / monture', count: 1 },
  { id: 'dofus', label: 'Dofus / trophées', count: 6 }
];

// Approximation volontaire pour l'optimiseur : les deux exos structurels usuels
// (+1 PA et +1 PM) sont intégrés directement à la base du personnage. Ils ne
// consomment donc aucun slot de FM offensive dans le solveur.
export const BASE_CHARACTER = Object.freeze({
  level: 200,
  characteristicPoints: 995,
  scrolled: { earth: 100, fire: 100, water: 100, air: 100 },
  baseStats: { ap: 8, mp: 4, vit: 1095 }
});

export const ELEMENT_SOFT_CAPS = Object.freeze([
  { amount: 100, cost: 1 },
  { amount: 100, cost: 2 },
  { amount: 100, cost: 3 },
  { amount: Infinity, cost: 4 }
]);

export const DEFAULT_CONSTRAINTS = Object.freeze({
  ap: 12,
  mp: 6,
  range: 0,
  vit: 0,
  resEarth: 0,
  resFire: 0,
  resWater: 0,
  resAir: 0
});

export const DEFAULT_FM = Object.freeze({
  spellDamagePct: 3,
  allowCritDamage: true,
  critDamageAmount: 8,
  structuralExos: false
});

export const TURN_MODES = [
  ['t1', 'T1'],
  ['t2', 'T2'],
  ['t3', 'T3'],
  ['sum', 'T1 + T2 + T3'],
  ['average', 'Moyenne T1–T3'],
  ['min', 'Pire tour']
];
