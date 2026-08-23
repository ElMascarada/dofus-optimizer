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
  const elements = [...new Set((spell.hits || []).map((hit) => hit.element).filter(Boolean))];
  return elements.map((element) => ELEMENT_LABELS[element] || element).join(' / ') || 'Dégâts';
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
