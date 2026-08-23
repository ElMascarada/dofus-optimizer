// Representative damage profiles used to stress different optimizer incentives.
// These are deliberately synthetic: they are stable regression fixtures, not canonical game data.
export const BENCHMARK_SPELL_PROFILES = [
  {
    id: 'mono-earth-nuke',
    name: 'Mono Terre — grosse base',
    intent: 'Favorise Force/Terre, Puissance et dommages finaux plutôt que les petits bonus plats.',
    spell: {
      id: 'bench-mono-earth-nuke',
      name: 'Benchmark mono Terre',
      baseCritPct: 0,
      distance: 'ranged',
      hits: [{ element: 'earth', normal: [100, 100], crit: [100, 100] }]
    }
  },
  {
    id: 'mono-fire-crit',
    name: 'Mono Feu — critique explosif',
    intent: 'Valorise le taux critique et les dommages critiques uniquement via leur gain réel.',
    spell: {
      id: 'bench-mono-fire-crit',
      name: 'Benchmark crit Feu',
      baseCritPct: 25,
      distance: 'ranged',
      hits: [{ element: 'fire', normal: [42, 42], crit: [78, 78] }]
    }
  },
  {
    id: 'earth-multihit',
    name: 'Terre — 4 lignes faibles',
    intent: 'Pousse les dommages fixes et Do Crit grâce à quatre lignes de dégâts.',
    spell: {
      id: 'bench-earth-multihit',
      name: 'Benchmark multi-lignes Terre',
      baseCritPct: 30,
      distance: 'melee',
      hits: [
        { element: 'earth', normal: [15, 15], crit: [20, 20] },
        { element: 'earth', normal: [15, 15], crit: [20, 20] },
        { element: 'earth', normal: [15, 15], crit: [20, 20] },
        { element: 'earth', normal: [15, 15], crit: [20, 20] }
      ]
    }
  },
  {
    id: 'air-water-dual',
    name: 'Air/Eau — bi-élément',
    intent: 'Teste qu’un stuff bi-élément peut battre les extrêmes mono lorsque les deux voies comptent.',
    spell: {
      id: 'bench-air-water-dual',
      name: 'Benchmark Air/Eau',
      baseCritPct: 15,
      distance: 'ranged',
      hits: [
        { element: 'air', normal: [36, 36], crit: [43, 43] },
        { element: 'water', normal: [36, 36], crit: [43, 43] }
      ]
    }
  },
  {
    id: 'omni-four-elements',
    name: 'Omni — 4 éléments',
    intent: 'Favorise la Puissance et les statistiques réellement multi-éléments.',
    spell: {
      id: 'bench-omni-four-elements',
      name: 'Benchmark Omni',
      baseCritPct: 20,
      distance: 'ranged',
      hits: [
        { element: 'earth', normal: [24, 24], crit: [29, 29] },
        { element: 'fire', normal: [24, 24], crit: [29, 29] },
        { element: 'water', normal: [24, 24], crit: [29, 29] },
        { element: 'air', normal: [24, 24], crit: [29, 29] }
      ]
    }
  },
  {
    id: 'melee-vs-ranged-control',
    name: 'Mêlée — contrôle bouclier',
    intent: 'Vérifie que les bonus mêlée/distance peuvent changer le choix du bouclier.',
    spell: {
      id: 'bench-melee-control',
      name: 'Benchmark mêlée',
      baseCritPct: 10,
      distance: 'melee',
      hits: [{ element: 'earth', normal: [55, 55], crit: [62, 62] }]
    }
  }
];

export function benchmarkSelection(profile, casts = { 1: 1, 2: 1, 3: 1 }) {
  return [{
    enabled: true,
    weight: 1,
    spell: profile.spell,
    casts
  }];
}
