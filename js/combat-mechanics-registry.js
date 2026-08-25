function normalizedIds(values = []) {
  return [...new Set((values || []).map((value) => String(value)).filter(Boolean))];
}

function normalizedTags(values = []) {
  return [...new Set((values || []).map((value) => String(value).trim()).filter(Boolean))];
}

function freezeDefinition(definition) {
  const matcher = Object.freeze({
    breedIds: Object.freeze(normalizedIds(definition.matcher?.breedIds)),
    spellIds: Object.freeze(normalizedIds(definition.matcher?.spellIds)),
    tags: Object.freeze(normalizedTags(definition.matcher?.tags))
  });
  return Object.freeze({ ...definition, matcher });
}

function matches(definition, context = {}) {
  const matcher = definition.matcher;
  if (matcher.breedIds.length && !matcher.breedIds.includes(String(context.breedId ?? ''))) return false;
  if (matcher.spellIds.length && !matcher.spellIds.includes(String(context.spellId ?? ''))) return false;
  if (matcher.tags.length) {
    const tags = new Set(normalizedTags(context.tags));
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

  return Object.freeze({
    all: () => [...entries],
    get: (id) => byId.get(String(id)) || null,
    matching: (context = {}) => entries.filter((definition) => matches(definition, context))
  });
}
