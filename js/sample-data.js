export const SAMPLE_SPELLS = [
  {
    id: 'carnage-demo',
    name: 'Carnage (démo)',
    baseCritPct: 25,
    distance: 'melee',
    hits: [{ element: 'earth', normal: [40, 44], crit: [48, 52] }]
  },
  {
    id: 'tempete-demo',
    name: 'Sort Feu (démo)',
    baseCritPct: 15,
    distance: 'ranged',
    hits: [{ element: 'fire', normal: [34, 38], crit: [41, 45] }]
  },
  {
    id: 'multi-demo',
    name: 'Sort Air/Eau (démo)',
    baseCritPct: 20,
    distance: 'ranged',
    hits: [
      { element: 'air', normal: [18, 20], crit: [22, 24] },
      { element: 'water', normal: [18, 20], crit: [22, 24] }
    ]
  }
];

const common = { level: 200 };
export const SAMPLE_ITEMS = [
  { ...common, id: 'hat-a', name: 'Coiffe Bastion', slot: 'hat', setId: 'set-a', stats: { earth: 90, power: 30, resEarth: 8, resFire: 7, resWater: 7, resAir: 7, vit: 360 } },
  { ...common, id: 'hat-b', name: 'Coiffe Précision', slot: 'hat', stats: { earth: 65, fire: 65, crit: 8, critDamage: 12, resEarth: 6, resFire: 6, resWater: 6, resAir: 6, vit: 330 } },
  { ...common, id: 'hat-c', name: 'Coiffe Polyvalente', slot: 'hat', stats: { power: 80, crit: 5, resEarth: 5, resFire: 5, resWater: 5, resAir: 5, vit: 320 } },

  { ...common, id: 'cape-a', name: 'Cape Bastion', slot: 'cape', setId: 'set-a', stats: { earth: 70, power: 35, resEarth: 8, resFire: 8, resWater: 8, resAir: 8, vit: 380 } },
  { ...common, id: 'cape-b', name: 'Cape Arcanique', slot: 'cape', stats: { fire: 90, power: 30, crit: 6, resEarth: 6, resFire: 9, resWater: 6, resAir: 6, vit: 340 } },
  { ...common, id: 'cape-c', name: 'Cape des Trois Voies', slot: 'cape', stats: { power: 75, resEarth: 7, resFire: 7, resWater: 7, resAir: 7, vit: 350 } },

  { ...common, id: 'amu-a', name: 'Amulette Bastion', slot: 'amulet', setId: 'set-a', stats: { earth: 75, power: 25, ap: 1, resEarth: 6, resFire: 6, resWater: 6, resAir: 6, vit: 330 } },
  { ...common, id: 'amu-b', name: 'Amulette Cyclique', slot: 'amulet', stats: { power: 60, ap: 1, crit: 5, resEarth: 5, resFire: 5, resWater: 5, resAir: 5, vit: 300 } },
  { ...common, id: 'amu-c', name: 'Amulette Équilibre', slot: 'amulet', stats: { earth: 45, fire: 45, water: 45, air: 45, ap: 1, vit: 320 } },

  { ...common, id: 'ring-a', name: 'Anneau Bastion', slot: 'ring', setId: 'set-a', stats: { ap: 1, earth: 60, power: 20, resEarth: 5, resFire: 5, resWater: 5, resAir: 5, vit: 260 } },
  { ...common, id: 'ring-b', name: 'Anneau Critique', slot: 'ring', stats: { ap: 1, power: 45, crit: 7, critDamage: 10, resEarth: 4, resFire: 4, resWater: 4, resAir: 4, vit: 240 } },
  { ...common, id: 'ring-c', name: 'Anneau Multi', slot: 'ring', stats: { ap: 1, earth: 30, fire: 30, water: 30, air: 30, power: 20, resEarth: 5, resFire: 5, resWater: 5, resAir: 5, vit: 250 } },
  { ...common, id: 'ring-d', name: 'Anneau Résistant', slot: 'ring', stats: { ap: 1, power: 35, resEarth: 8, resFire: 8, resWater: 8, resAir: 8, vit: 300 } },

  { ...common, id: 'belt-a', name: 'Ceinture Bastion', slot: 'belt', setId: 'set-a', stats: { ap: 1, earth: 65, power: 20, resEarth: 7, resFire: 7, resWater: 7, resAir: 7, vit: 320 } },
  { ...common, id: 'belt-b', name: 'Ceinture Multi', slot: 'belt', stats: { ap: 1, power: 70, resEarth: 5, resFire: 5, resWater: 5, resAir: 5, vit: 300 } },

  { ...common, id: 'boots-a', name: 'Bottes Bastion', slot: 'boots', setId: 'set-a', stats: { earth: 65, mp: 1, resEarth: 7, resFire: 7, resWater: 7, resAir: 7, vit: 320 } },
  { ...common, id: 'boots-b', name: 'Bottes Multi', slot: 'boots', stats: { power: 55, mp: 1, crit: 4, resEarth: 5, resFire: 5, resWater: 5, resAir: 5, vit: 290 } },

  { ...common, id: 'weapon-a', name: 'Lame Tellurique', slot: 'weapon', stats: { earth: 110, power: 30, damageEarth: 15, vit: 280 } },
  { ...common, id: 'weapon-b', name: 'Bâton Polyvalent', slot: 'weapon', stats: { power: 100, crit: 5, vit: 260 } },

  { ...common, id: 'shield-a', name: 'Bouclier Mêlée', slot: 'shield', stats: { meleeDamagePct: 12, resEarth: 5, resFire: 5, resWater: 5, resAir: 5, vit: 220 } },
  { ...common, id: 'shield-b', name: 'Bouclier Distance', slot: 'shield', stats: { rangedDamagePct: 12, resEarth: 5, resFire: 5, resWater: 5, resAir: 5, vit: 220 } },
  { ...common, id: 'shield-c', name: 'Bouclier Stable', slot: 'shield', stats: { power: 35, resEarth: 8, resFire: 8, resWater: 8, resAir: 8, vit: 260 } },

  { ...common, id: 'pet-a', name: 'Familier Force', slot: 'companion', stats: { earth: 120, power: 20 } },
  { ...common, id: 'pet-b', name: 'Montilier Mobile', slot: 'companion', stats: { power: 100, crit: 5, mp: 1 } },

  { ...common, id: 'dofus-a', name: 'Dofus PA (démo)', slot: 'dofus', stats: { power: 45, ap: 1 }, turnBonuses: { 1: { finalDamagePctT1: 6 } } },
  { ...common, id: 'dofus-b', name: 'Dofus PM T2 (démo)', slot: 'dofus', stats: { power: 45, mp: 1 }, turnBonuses: { 2: { finalDamagePctT2: 8 } } },
  { ...common, id: 'dofus-c', name: 'Trophée Résistant', slot: 'dofus', stats: { resEarth: 6, resFire: 6, resWater: 6, resAir: 6, vit: 200 } },
  { ...common, id: 'dofus-d', name: 'Trophée Puissance', slot: 'dofus', stats: { power: 80 } },
  { ...common, id: 'dofus-e', name: 'Trophée Tellurique', slot: 'dofus', stats: { earth: 80, damageEarth: 8 } },
  { ...common, id: 'dofus-f', name: 'Trophée Polyvalent', slot: 'dofus', stats: { power: 45, resEarth: 3, resFire: 3, resWater: 3, resAir: 3 } }
];

export const SAMPLE_SETS = [
  {
    id: 'set-a',
    name: 'Panoplie Bastion',
    bonuses: {
      '2': { power: 20 },
      '3': { power: 35, resEarth: 2, resFire: 2, resWater: 2, resAir: 2 },
      '4': { power: 50, resEarth: 3, resFire: 3, resWater: 3, resAir: 3 },
      '5': { power: 65, ap: 1, resEarth: 4, resFire: 4, resWater: 4, resAir: 4 },
      '6': { power: 80, ap: 1, resEarth: 5, resFire: 5, resWater: 5, resAir: 5 }
    }
  }
];
