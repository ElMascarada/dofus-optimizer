const ELEMENT_LABELS = {
  earth: 'Terre',
  fire: 'Feu',
  water: 'Eau',
  air: 'Air',
  neutral: 'Neutre'
};

export function spellsForBreed(spellData, breedId) {
  const allowed = new Set((spellData?.breeds || []).find((breed) => breed.id === breedId)?.spellIds || []);
  return (spellData?.spells || []).filter((spell) => allowed.has(spell.id));
}

export function spellElements(spell = {}) {
  return [...new Set((spell.hits || []).map((hit) => hit.element).filter(Boolean))];
}

export function spellMatchesElement(spell = {}, element = 'multi') {
  if (element === 'multi' || !element) return (spell.hits || []).length > 0;
  return spellElements(spell).includes(element);
}

export function combatSpellsForElement(spellData, breedId, element = 'multi') {
  return spellsForBreed(spellData, breedId).filter((spell) => {
    const hasSupport = Array.isArray(spell.combatModifiers) && spell.combatModifiers.length > 0;
    const hasMatchingDamage = spellMatchesElement(spell, element);
    // A support spell remains available even if its own incidental damage is in
    // another element: the turn optimizer may still decide that its buff/debuff
    // is worth the AP cost before the requested-element attacks.
    return hasSupport || hasMatchingDamage;
  });
}

export function castCap(spell = {}) {
  const positive = [spell.maxCastPerTurn, spell.maxCastPerTarget]
    .map(Number)
    .filter((value) => Number.isFinite(value) && value > 0);
  return positive.length ? Math.max(1, Math.min(...positive)) : 6;
}

export function distanceOptions(spell = {}) {
  const options = Array.isArray(spell.distanceOptions) ? spell.distanceOptions.filter((value) => value === 'melee' || value === 'ranged') : [];
  return options.length ? [...new Set(options)] : ['ranged'];
}

export function defaultDistance(spell = {}) {
  const options = distanceOptions(spell);
  return options.length === 1 ? options[0] : null;
}

export function spellElementLabel(spell = {}) {
  const elements = spellElements(spell);
  return elements.map((element) => ELEMENT_LABELS[element] || element).join(' / ') || 'Support';
}

export function requiredApByTurn(selections = []) {
  const result = { 1: 0, 2: 0, 3: 0 };
  for (const selection of selections) {
    if (!selection?.enabled) continue;
    const apCost = Math.max(0, Number(selection.spell?.apCost || 0));
    for (const turn of [1, 2, 3]) {
      const casts = Math.max(0, Number(selection.casts?.[turn] || 0));
      result[turn] += apCost * casts;
    }
  }
  return result;
}
