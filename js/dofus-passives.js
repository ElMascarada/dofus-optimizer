const ITEM_PASSIVE_RULES = new Map([
  [694, {
    id: 'deep-purple',
    label: 'Pourpre Profond',
    consumeDynamicEffects: true,
    rules: [{
      id: 'received-attack-stacks',
      trigger: { type: 'always' },
      scaledStats: [{ stat: 'finalDamagePct', contextKey: 'pourpreStacks', multiplier: 1, min: 0, max: 10 }]
    }]
  }],
  [739, {
    id: 'turquoise-blue',
    label: 'Bleu Turquoise',
    consumeDynamicEffects: true,
    rules: [{
      id: 'critical-hit-stacks',
      trigger: { type: 'always' },
      scaledStats: [{ stat: 'finalDamagePct', contextKey: 'turquoiseStacks', multiplier: 1, min: 0, max: 10 }]
    }]
  }],
  [958, {
    id: 'dofusteuse-blessing',
    label: 'Bénédiction des Dofus',
    consumeDynamicEffects: true,
    rules: [
      { id: 'chance', trigger: { type: 'turn_cycle', length: 4, position: 1 }, stats: { water: 400 } },
      { id: 'strength', trigger: { type: 'turn_cycle', length: 4, position: 2 }, stats: { earth: 400 } },
      { id: 'agility', trigger: { type: 'turn_cycle', length: 4, position: 3 }, stats: { air: 400 } },
      { id: 'intelligence', trigger: { type: 'turn_cycle', length: 4, position: 4 }, stats: { fire: 400 } }
    ]
  }],
  [6980, {
    id: 'vermilion-red',
    label: 'Rouge Vermeil',
    consumeDynamicEffects: true,
    rules: [
      { id: 'not-attacked', trigger: { type: 'context_equals', key: 'attackedSinceLastTurn', value: false }, stats: { finalDamagePct: 10 } },
      { id: 'attacked', trigger: { type: 'context_equals', key: 'attackedSinceLastTurn', value: true }, stats: { lock: 20 } }
    ]
  }],
  [7754, {
    id: 'yellow-ochre',
    label: 'Jaune Ocre',
    consumeDynamicEffects: true,
    rules: [
      { id: 'not-attacked', trigger: { type: 'context_equals', key: 'attackedSinceLastTurn', value: false }, stats: { ap: 1 } },
      { id: 'attacked', trigger: { type: 'context_equals', key: 'attackedSinceLastTurn', value: true }, stats: { dodge: 20 } }
    ]
  }],
  [8698, {
    id: 'nebulous-dream',
    label: 'Rêve Nébuleux',
    consumeDynamicEffects: true,
    rules: [
      {
        id: 'odd-turn',
        trigger: { type: 'turn_parity', parity: 'odd' },
        stats: { finalDamagePct: 20, finalHealingPct: -10 }
      },
      {
        id: 'even-turn',
        trigger: { type: 'turn_parity', parity: 'even' },
        stats: { finalDamagePct: -10, finalHealingPct: 20 }
      }
    ]
  }],
  [18043, {
    id: 'descent-to-abyss',
    label: 'Descente aux Abysses',
    consumeDynamicEffects: true,
    rules: [
      { id: 'no-adjacent-enemy', trigger: { type: 'context_equals', key: 'enemyAdjacent', value: false }, stats: { mp: 1 } },
      { id: 'adjacent-enemy', trigger: { type: 'context_equals', key: 'enemyAdjacent', value: true }, stats: { ap: 1 } }
    ]
  }],
  [20358, {
    id: 'cheat-death',
    label: 'Trompe-la-Mort',
    consumeDynamicEffects: true,
    rules: [
      { id: 'above-half-hp', trigger: { type: 'context_compare', key: 'hpPct', operator: 'gt', value: 50 }, stats: { finalDamagePct: 7 } },
      { id: 'at-or-below-half-hp', trigger: { type: 'context_compare', key: 'hpPct', operator: 'lte', value: 50 }, stats: { incomingDamageReductionPct: 20 } }
    ]
  }],
  [21995, {
    id: 'sprynt',
    label: 'Sprynt',
    consumeDynamicEffects: true,
    rules: []
  }],
  [21996, {
    id: 'pryssion-matte',
    label: 'Pryssion Mate',
    consumeDynamicEffects: true,
    rules: [
      { id: 'turns-1-to-3', trigger: { type: 'turn_in', turns: [1, 2, 3] }, stats: { ap: 1, finalDamagePct: -10 } }
    ]
  }],
  [21997, {
    id: 'pryssion-bright',
    label: 'Pryssion Brillante',
    consumeDynamicEffects: true,
    rules: [
      { id: 'turns-1-to-2', trigger: { type: 'turn_in', turns: [1, 2] }, stats: { ap: 2, finalDamagePct: -35 } }
    ]
  }],
  [21998, {
    id: 'pryssion-iridescent',
    label: 'Pryssion Iridescente',
    consumeDynamicEffects: true,
    rules: [
      { id: 'turn-1', trigger: { type: 'turn_in', turns: [1] }, stats: { ap: 3, finalDamagePct: -50 } }
    ]
  }],
  [22001, {
    id: 'surpryz',
    label: 'Surpryz',
    consumeDynamicEffects: true,
    rules: [
      { id: 'turn-1', trigger: { type: 'turn_in', turns: [1] }, stats: { crit: 100 } },
      { id: 'turn-2', trigger: { type: 'turn_in', turns: [2] }, stats: { crit: 35 } },
      { id: 'turn-3', trigger: { type: 'turn_in', turns: [3] }, stats: { crit: 15 } }
    ]
  }],
  [22004, {
    id: 'prynyang',
    label: 'Prynyang',
    consumeDynamicEffects: true,
    rules: [
      {
        id: 'turn-1',
        trigger: { type: 'turn_in', turns: [1] },
        stats: { finalDamagePct: 10, resEarth: -10, resFire: -10, resWater: -10, resAir: -10 }
      },
      {
        id: 'turn-2',
        trigger: { type: 'turn_in', turns: [2] },
        stats: { finalDamagePct: 3, resEarth: 3, resFire: 3, resWater: 3, resAir: 3 }
      },
      {
        id: 'turn-3',
        trigger: { type: 'turn_in', turns: [3] },
        stats: { finalDamagePct: -10, resEarth: 10, resFire: 10, resWater: 10, resAir: 10 }
      }
    ]
  }],
  [22007, {
    id: 'ratrapry',
    label: 'Ratrapry',
    consumeDynamicEffects: true,
    rules: [
      {
        id: 'far-enemies-first-three-turns',
        trigger: { type: 'turn_in', turns: [1, 2, 3] },
        scaledStats: [{ stat: 'mp', contextKey: 'farEnemiesOver9', multiplier: 1, min: 0, max: 3 }]
      }
    ]
  }],
  [22011, {
    id: 'prycipithon-matte',
    label: 'Prycipithon Mate',
    consumeDynamicEffects: true,
    rules: [
      { id: 'turn-1', trigger: { type: 'turn_in', turns: [1] }, stats: { ap: 2 } }
    ]
  }],
  [22012, {
    id: 'prycipithon-bright',
    label: 'Prycipithon Brillante',
    consumeDynamicEffects: true,
    rules: [
      { id: 'turn-1', trigger: { type: 'turn_in', turns: [1] }, stats: { ap: 3, mp: -2 } }
    ]
  }],
  [22013, {
    id: 'prycipithon-iridescent',
    label: 'Prycipithon Iridescente',
    consumeDynamicEffects: true,
    rules: [
      { id: 'turn-1', trigger: { type: 'turn_in', turns: [1] }, stats: { ap: 4, mp: -4 } }
    ]
  }],
  [22020, {
    id: 'prysmenvout',
    label: 'Prysmenvout',
    consumeDynamicEffects: true,
    rules: []
  }],
  [22023, {
    id: 'pryximite',
    label: 'Pryximite',
    consumeDynamicEffects: true,
    rules: [
      {
        id: 'near-enemies-t1',
        trigger: { type: 'turn_in', turns: [1, 2, 3] },
        scaledStats: [
          { stat: 'meleeDamagePct', contextKey: 'pryximiteNearbyEnemiesStartT1', multiplier: 2, min: 0 },
          { stat: 'meleeDamagePct', contextKey: 'pryximiteNearbyEnemiesEndT1', multiplier: 2, min: 0 }
        ]
      }
    ]
  }]
]);

export function passiveDefinitionForItem(rawItem = {}) {
  const id = Number(rawItem?.ankama_id ?? rawItem?.ankamaId);
  return ITEM_PASSIVE_RULES.get(id) || null;
}

function sourceEffectName(effect, elements = []) {
  const id = Number(effect?.type?.id);
  if (Number.isInteger(id) && typeof elements[id] === 'string') return elements[id];
  return effect?.type?.name || effect?.formatted || null;
}

function cloneRule(rule) {
  return {
    ...rule,
    trigger: rule.trigger ? structuredClone(rule.trigger) : undefined,
    stats: { ...(rule.stats || {}) },
    scaledStats: (rule.scaledStats || []).map((entry) => ({ ...entry }))
  };
}

export function extractKnownItemPassives(rawItem = {}, effects = [], elements = []) {
  const definition = passiveDefinitionForItem(rawItem);
  if (!definition) return { kept: effects || [], passives: [], consumed: [] };

  const kept = [];
  const consumed = [];
  for (const effect of effects || []) {
    const isDynamic = Boolean(effect?.type?.is_active || effect?.type?.is_meta);
    if (definition.consumeDynamicEffects && isDynamic) consumed.push(effect);
    else kept.push(effect);
  }

  return {
    kept,
    passives: [{
      id: definition.id,
      label: definition.label,
      source: 'curated-item-rule',
      rules: definition.rules.map(cloneRule)
    }],
    consumed: consumed.map((effect) => ({
      name: sourceEffectName(effect, elements),
      formatted: effect?.formatted || null,
      active: Boolean(effect?.type?.is_active),
      meta: Boolean(effect?.type?.is_meta)
    }))
  };
}

export function isKnownTemporalItem(rawItem = {}) {
  return Boolean(passiveDefinitionForItem(rawItem));
}

export function passiveRegistrySummary() {
  return [...ITEM_PASSIVE_RULES.entries()].map(([ankamaId, rule]) => ({ ankamaId, id: rule.id, label: rule.label }));
}
