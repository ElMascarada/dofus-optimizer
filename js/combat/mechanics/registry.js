function normalizedIds(values = []) {
  return [...new Set((values || []).map((value) => String(value)).filter(Boolean))];
}

function normalizedTags(values = []) {
  return [...new Set((values || []).map((value) => String(value).trim()).filter(Boolean))];
}

function freezeMatcher(matcher = {}) {
  return Object.freeze({
    breedIds: Object.freeze(normalizedIds(matcher.breedIds)),
    breedAnkamaIds: Object.freeze(normalizedIds(matcher.breedAnkamaIds)),
    spellIds: Object.freeze(normalizedIds(matcher.spellIds)),
    spellAnkamaIds: Object.freeze(normalizedIds(matcher.spellAnkamaIds)),
    tags: Object.freeze(normalizedTags(matcher.tags))
  });
}

function freezeDefinition(definition) {
  return Object.freeze({ ...definition, matcher: freezeMatcher(definition.matcher) });
}

function contextTags(context = {}) {
  return normalizedTags([
    ...(context.tags || []),
    ...(context.spell?.tags || []),
    ...(context.spell?.mechanicTags || [])
  ]);
}

export function mechanicContextForSpell(spell = {}, extra = {}) {
  return {
    ...extra,
    spell,
    breedId: extra.breedId ?? spell.breedId,
    breedAnkamaId: extra.breedAnkamaId ?? spell.breedAnkamaId,
    spellId: extra.spellId ?? spell.id,
    spellAnkamaId: extra.spellAnkamaId ?? spell.ankamaId,
    tags: contextTags({ ...extra, spell })
  };
}

export function mechanicMatches(definition, context = {}) {
  const matcher = definition.matcher || freezeMatcher();
  if (matcher.breedIds.length && !matcher.breedIds.includes(String(context.breedId ?? ''))) return false;
  if (matcher.breedAnkamaIds.length && !matcher.breedAnkamaIds.includes(String(context.breedAnkamaId ?? ''))) return false;
  if (matcher.spellIds.length && !matcher.spellIds.includes(String(context.spellId ?? ''))) return false;
  if (matcher.spellAnkamaIds.length && !matcher.spellAnkamaIds.includes(String(context.spellAnkamaId ?? ''))) return false;
  if (matcher.tags.length) {
    const tags = new Set(contextTags(context));
    if (!matcher.tags.every((tag) => tags.has(tag))) return false;
  }
  return true;
}

export function createCombatMechanicRegistry(definitions = []) {
  const entries = [];
  const byId = new Map();

  for (const rawDefinition of definitions || []) {
    const id = String(rawDefinition?.id || '').trim();
    if (!id) throw new Error('Combat mechanic definition requires an id.');
    if (byId.has(id)) throw new Error(`Duplicate combat mechanic id: ${id}`);
    const definition = freezeDefinition({ ...rawDefinition, id });
    entries.push(definition);
    byId.set(id, definition);
  }

  function matching(context = {}) {
    return entries.filter((definition) => mechanicMatches(definition, context));
  }

  function prepareSpell(spell = {}) {
    let prepared = spell;
    for (const definition of entries) {
      const context = mechanicContextForSpell(prepared);
      if (!mechanicMatches(definition, context) || typeof definition.prepareSpell !== 'function') continue;
      prepared = definition.prepareSpell(prepared, context) || prepared;
    }
    return prepared;
  }

  function hookEffects(hookName, context = {}) {
    const spellContext = context.spell ? mechanicContextForSpell(context.spell, context) : context;
    const groups = [];
    for (const definition of matching(spellContext)) {
      const hook = definition.hooks?.[hookName];
      if (typeof hook !== 'function') continue;
      const effects = hook({ ...spellContext, mechanic: definition }) || [];
      if (!Array.isArray(effects) || !effects.length) continue;
      groups.push({ definitionId: definition.id, effects });
    }
    return groups;
  }

  return Object.freeze({
    all: () => [...entries],
    get: (id) => byId.get(String(id)) || null,
    matching,
    prepareSpell,
    hookEffects
  });
}
