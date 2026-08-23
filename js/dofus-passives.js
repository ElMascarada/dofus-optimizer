const ITEM_PASSIVE_RULES = new Map([
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
      rules: definition.rules.map((rule) => ({ ...rule, trigger: { ...rule.trigger }, stats: { ...rule.stats } }))
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
