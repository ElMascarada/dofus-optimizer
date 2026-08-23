const ELEMENT_BY_EFFECT_ID = new Map([
  [91, 'water'],
  [92, 'earth'],
  [93, 'air'],
  [94, 'fire'],
  [95, 'neutral'],
  [96, 'water'],
  [97, 'earth'],
  [98, 'air'],
  [99, 'fire'],
  [100, 'neutral']
]);

const EXPECTED_EFFECT_LABEL = new Map([
  [91, /vol Eau/i],
  [92, /vol Terre/i],
  [93, /vol Air/i],
  [94, /vol Feu/i],
  [95, /vol Neutre/i],
  [96, /dommages Eau/i],
  [97, /dommages Terre/i],
  [98, /dommages Air/i],
  [99, /dommages Feu/i],
  [100, /dommages Neutre/i]
]);

const UNSUPPORTED_DYNAMIC_DAMAGE_EFFECTS = new Set([2822, 2828]);

function arrayField(value) {
  return Array.isArray(value) ? value : Array.isArray(value?.Array) ? value.Array : [];
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function releaseRecords(payload = {}, className = null) {
  const refs = arrayField(payload?.references?.RefIds);
  return refs
    .filter((entry) => !className || entry?.type?.class === className)
    .map((entry) => entry?.data)
    .filter(Boolean);
}

export function translationEntries(payload = {}) {
  return payload?.entries && typeof payload.entries === 'object' ? payload.entries : {};
}

export function auditFixedDamageRegistry(effectsPayload = {}, translationsPayload = {}) {
  const translations = translationEntries(translationsPayload);
  const effects = releaseRecords(effectsPayload);
  const byId = new Map(effects.map((effect) => [number(effect.id, -1), effect]));
  const errors = [];

  for (const [effectId, expectedLabel] of EXPECTED_EFFECT_LABEL) {
    const meta = byId.get(effectId);
    const label = meta ? translations[String(meta.descriptionId)] : null;
    if (!meta) {
      errors.push(`effect ${effectId}: missing`);
      continue;
    }
    if (!ELEMENT_BY_EFFECT_ID.has(effectId) || !expectedLabel.test(String(label || ''))) {
      errors.push(`effect ${effectId}: unexpected label ${JSON.stringify(label)}`);
    }
    if (number(meta.category, -1) !== 2 || number(meta.useInFight, 0) !== 1 || number(meta.useDice, 0) !== 1) {
      errors.push(`effect ${effectId}: unexpected metadata`);
    }
  }

  return { valid: errors.length === 0, errors };
}

function effectRange(effect = {}) {
  let min = number(effect.diceNum, 0);
  let max = number(effect.diceSide, 0);
  const value = number(effect.value, 0);
  if (min === 0 && value !== 0) min = value;
  if (max === 0) max = min;
  if (min > max) [min, max] = [max, min];
  return [min, max];
}

function isImmediate(effect = {}) {
  const trigger = String(effect.triggers ?? 'I');
  return trigger === 'I'
    && number(effect.duration, 0) === 0
    && number(effect.delay, 0) === 0
    && number(effect.random, 0) === 0;
}

function analyzeDamageEffects(effects = []) {
  const hits = [];
  let hasKnownDamage = false;
  let unsupportedReason = null;

  for (const effect of effects) {
    const effectId = number(effect?.effectId, -1);
    if (UNSUPPORTED_DYNAMIC_DAMAGE_EFFECTS.has(effectId)) {
      hasKnownDamage = true;
      unsupportedReason ||= 'best-element-damage';
      continue;
    }
    const element = ELEMENT_BY_EFFECT_ID.get(effectId);
    if (!element) continue;
    hasKnownDamage = true;
    if (!isImmediate(effect)) {
      unsupportedReason ||= 'conditional-or-delayed-damage';
      continue;
    }
    const range = effectRange(effect);
    if (!(range[0] > 0) || !(range[1] > 0)) {
      unsupportedReason ||= 'invalid-damage-range';
      continue;
    }
    hits.push({
      element,
      range,
      effectId,
      sourceOrder: number(effect.order, hits.length)
    });
  }

  hits.sort((a, b) => a.sourceOrder - b.sourceOrder);
  return { hits, hasKnownDamage, unsupportedReason };
}

function selectLevel(spell = {}, levelsById = new Map(), characterLevel = 200) {
  return arrayField(spell.spellLevels)
    .map((id) => levelsById.get(number(id, -1)))
    .filter((level) => level && number(level.minPlayerLevel, 0) <= characterLevel)
    .sort((a, b) => number(b.minPlayerLevel, 0) - number(a.minPlayerLevel, 0) || number(b.grade, 0) - number(a.grade, 0))[0] || null;
}

function distanceOptions(level = {}) {
  const minRange = Math.max(0, number(level.minRange, 0));
  const maxRange = Math.max(minRange, number(level.range, minRange));
  if (maxRange <= 2) return ['melee'];
  if (minRange >= 3) return ['ranged'];
  return ['melee', 'ranged'];
}

function normalizeOneSpell({ spell, level, breed, translations }) {
  const normal = analyzeDamageEffects(arrayField(level.effects));
  const critical = analyzeDamageEffects(arrayField(level.criticalEffect));
  const hasKnownDamage = normal.hasKnownDamage || critical.hasKnownDamage;

  if (normal.unsupportedReason || critical.unsupportedReason) {
    return { status: 'unsupported', reason: normal.unsupportedReason || critical.unsupportedReason, hasKnownDamage };
  }
  if (!normal.hits.length) return { status: 'non-offensive', reason: 'no-fixed-direct-damage', hasKnownDamage };

  const baseCritPct = Math.max(0, number(level.criticalHitProbability, 0));
  const critHits = critical.hits.length ? critical.hits : (baseCritPct === 0 ? normal.hits : []);
  if (baseCritPct > 0 && !critHits.length) {
    return { status: 'unsupported', reason: 'missing-critical-damage', hasKnownDamage: true };
  }
  if (critHits.length !== normal.hits.length) {
    return { status: 'unsupported', reason: 'critical-hit-count-mismatch', hasKnownDamage: true };
  }
  for (let index = 0; index < normal.hits.length; index++) {
    if (normal.hits[index].element !== critHits[index].element) {
      return { status: 'unsupported', reason: 'critical-element-mismatch', hasKnownDamage: true };
    }
  }

  const ankamaId = number(spell.id, -1);
  const breedAnkamaId = number(breed.id, -1);
  const name = translations[String(spell.nameId)] || `Sort #${ankamaId}`;
  const breedName = translations[String(breed.shortNameId)] || `Classe #${breedAnkamaId}`;
  const minRange = Math.max(0, number(level.minRange, 0));
  const maxRange = Math.max(minRange, number(level.range, minRange));

  return {
    status: 'certified',
    hasKnownDamage: true,
    spell: {
      id: `spell-${ankamaId}`,
      ankamaId,
      name,
      breedId: `breed-${breedAnkamaId}`,
      breedAnkamaId,
      breedName,
      order: number(spell.order, 0),
      iconId: number(spell.iconId, 0),
      levelId: number(level.id, -1),
      grade: number(level.grade, 0),
      minPlayerLevel: number(level.minPlayerLevel, 0),
      apCost: Math.max(0, number(level.apCost, 0)),
      baseCritPct,
      minRange,
      maxRange,
      distanceOptions: distanceOptions(level),
      maxCastPerTurn: Math.max(0, number(level.maxCastPerTurn, 0)),
      maxCastPerTarget: Math.max(0, number(level.maxCastPerTarget, 0)),
      hits: normal.hits.map((hit, index) => ({
        element: hit.element,
        normal: [...hit.range],
        crit: [...critHits[index].range]
      })),
      damageSource: 'spell',
      model: 'direct-fixed-element',
      certified: true
    }
  };
}

export function normalizeDofusSpellCatalog({
  spellsPayload = {},
  levelsPayload = {},
  breedsPayload = {},
  effectsPayload = {},
  translationsPayload = {},
  gameVersion = {},
  generatedAt = null,
  characterLevel = 200
} = {}) {
  const registryAudit = auditFixedDamageRegistry(effectsPayload, translationsPayload);
  if (!registryAudit.valid) throw new Error(`Dofus spell damage registry mismatch: ${registryAudit.errors.join('; ')}`);

  const translations = translationEntries(translationsPayload);
  const spells = releaseRecords(spellsPayload, 'SpellData');
  const levels = releaseRecords(levelsPayload, 'SpellLevelData');
  const breeds = releaseRecords(breedsPayload, 'BreedData')
    .filter((breed) => arrayField(breed.breedSpellsId).length)
    .sort((a, b) => number(a.sortIndex, 0) - number(b.sortIndex, 0) || number(a.id, 0) - number(b.id, 0));

  const spellsById = new Map(spells.map((spell) => [number(spell.id, -1), spell]));
  const levelsById = new Map(levels.map((level) => [number(level.id, -1), level]));
  const normalizedSpells = [];
  const normalizedBreeds = [];
  const skipped = {};
  let classSpellRefs = 0;
  let offensiveCandidates = 0;

  for (const breed of breeds) {
    const breedAnkamaId = number(breed.id, -1);
    const breedId = `breed-${breedAnkamaId}`;
    const breedName = translations[String(breed.shortNameId)] || `Classe #${breedAnkamaId}`;
    const breedSpellIds = [];
    let breedTotal = 0;
    let breedCertified = 0;

    for (const spellIdRaw of arrayField(breed.breedSpellsId)) {
      classSpellRefs++;
      breedTotal++;
      const spell = spellsById.get(number(spellIdRaw, -1));
      if (!spell) {
        skipped['missing-spell-record'] = (skipped['missing-spell-record'] || 0) + 1;
        continue;
      }
      const level = selectLevel(spell, levelsById, characterLevel);
      if (!level) {
        skipped['missing-level-200'] = (skipped['missing-level-200'] || 0) + 1;
        continue;
      }
      const result = normalizeOneSpell({ spell, level, breed, translations });
      if (result.hasKnownDamage) offensiveCandidates++;
      if (result.status !== 'certified') {
        skipped[result.reason] = (skipped[result.reason] || 0) + 1;
        continue;
      }
      normalizedSpells.push(result.spell);
      breedSpellIds.push(result.spell.id);
      breedCertified++;
    }

    normalizedBreeds.push({
      id: breedId,
      ankamaId: breedAnkamaId,
      name: breedName,
      spellIds: breedSpellIds,
      sourceSpellCount: breedTotal,
      certifiedSpellCount: breedCertified
    });
  }

  normalizedSpells.sort((a, b) => a.breedAnkamaId - b.breedAnkamaId || a.order - b.order || a.name.localeCompare(b.name, 'fr'));

  return {
    schemaVersion: 1,
    source: 'dofusdude-release',
    game: 'dofus3',
    language: 'fr',
    gameVersion,
    generatedAt,
    characterLevel,
    model: 'direct-fixed-element',
    breeds: normalizedBreeds,
    spells: normalizedSpells,
    coverage: {
      breedCount: normalizedBreeds.length,
      classSpellRefs,
      offensiveCandidates,
      certified: normalizedSpells.length,
      skipped
    }
  };
}
