import './runtime-meta.js';

export const APP_VERSION = globalThis.DofusOptimizerRuntime.appVersion;

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

// Base réelle du personnage : aucune forgemagie structurelle n'est supposée.
// Les exos PA/PM sont désormais des choix utilisateur explicites transportés
// dans fmPolicy et appliqués par le moteur au moment de l'évaluation.
export const BASE_CHARACTER = Object.freeze({
  level: 200,
  characteristicPoints: 995,
  scrolled: { earth: 100, fire: 100, water: 100, air: 100 },
  baseStats: { ap: 7, mp: 3, vit: 1095 }
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

// Règle produit canonique : sans sélection utilisateur, aucune FM n'est
// appliquée. critDamageAmount reste uniquement l'amplitude de la FM Do Crit
// lorsqu'elle est explicitement activée.
export const DEFAULT_FM = Object.freeze({
  spellDamagePct: 0,
  allowCritDamage: false,
  critDamageAmount: 8,
  exoAp: 0,
  exoMp: 0
});

export const TURN_MODES = [
  ['t1', 'T1'],
  ['t2', 'T2'],
  ['t3', 'T3'],
  ['sum', 'T1 + T2 + T3'],
  ['average', 'Moyenne T1–T3'],
  ['min', 'Pire tour'],
  ['constant', 'Constant']
];
