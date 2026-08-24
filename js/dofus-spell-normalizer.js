import {
  buildSpellEffectRegistry,
  extractDeterministicCombatModifiers,
  spellAreaHint
} from './spell-combat-effects.js';

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

function uniqueNumericIds(values = []) {
  const seen = new Set();
  const output = [];
  for (const raw of values) {
    const id = number(raw, -1);
    if (id < 0 || seen.has(id)) continue;
    seen.add(id);
    output.push(id);
  }
  return output;
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

function normalizeOneSpell({ spell, level, breed, translations, combatEffectRegistry }) {
  const rawEffects = arrayField(level.effects);
  const rawCritical = arrayField(level.criticalEffect);
  const normal = analyzeDamageEffects(rawEffects);
  const critical = analyzeDamageEffects(rawCritical);
  const hasKnownDamage = normal.hasKnownDamage || critical.hasKnownDamage;
  const combat = extractDeterministicCombatModifiers(rawEffects, combatEffectRegistry, level);
  const hasCombatModifiers = combat.modifiers.length > 0;

  if (normal.unsupportedReason || critical.unsupportedReason) {
    return { status: 'unsupported', reason: normal.unsupportedReason || critical.unsupportedReason, hasKnownDamage, hasCombatModifiers };
  }
  if (!normal.hits.length && !hasCombatModifiers) {
    return { status: 'irrelevant', reason: 'no-fixed-direct-damage-or-supported-buff', hasKnownDamage, hasCombatModifiers: false };
  }

  const baseCritPct = Math.max(0, number(level.criticalHitProbability, 0));
  let critHits = [];
  if (normal.hits.length) {
    critHits = critical.hits.length ? critical.hits : (baseCritPct === 0 ? normal.hits : []);
    if (baseCritPct > 0 && !critHits.length) {
      return { status: 'unsupported', reason: 'missing-critical-damage', hasKnownDamage: true, hasCombatModifiers };
    }
    if (critHits.length !== normal.hits.length) {
      return { status: 'unsupported', reason: 'critical-hit-count-mismatch', hasKnownDamage: true, hasCombatModifiers };
    }
    for (let index = 0; index < normal.hits.length; index++) {
      if (normal.hits[index].element !== critHits[index].element) {
        return { status: 'unsupported', reason: 'critical-element-mismatch', hasKnownDamage: true, hasCombatModifiers };
      }
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
    hasKnownDamage,
    hasCombatModifiers,
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
      minCastInterval: Math.max(0, number(level.minCastInterval ?? level.minCastIntervalTurns, 0)),
      initialCooldown: Math.max(0, number(level.initialCooldown ?? level.initialCooldownTurns, 0)),
      isArea: spellAreaHint(rawEffects),
      hits: normal.hits.map((hit, index) => ({
        element: hit.element,
        normal: [...hit.range],
        crit: [...critHits[index].range]
      })),
      combatModifiers: combat.modifiers,
      combatModifierCoverage: {
        supported: combat.modifiers.length,
        ignored: combat.ignored.length
      },
      combatRelevant: normal.hits.length > 0 || hasCombatModifiers,
      supportOnly: normal.hits.length === 0 && hasCombatModifiers,
      damageSource: 'spell',
      model: hasCombatModifiers ? 'direct-damage-plus-deterministic-effects' : 'direct-fixed-element',
      certified: true
    }
  };
}

function variantIndex(variantsPayload = {}) {
  const byBreed = new Map();
  for (const variant of releaseRecords(variantsPayload)) {
    const breedId = number(
      variant?.breedId
      ?? variant?.breed_id
      ?? variant?.breed?.id
      ?? variant?.breed
      ?? variant?.id,
      -1
    );
    if (breedId < 0) continue;
    const spellIds = uniqueNumericIds(arrayField(
      variant?.spellIds
      ?? variant?.spell_ids
      ?? variant?.spells
      ?? variant?.variants
      ?? variant?.spellVariants
    ));
    if (!spellIds.length) continue;
    if (!byBreed.has(breedId)) byBreed.set(breedId, new Set());
    const target = byBreed.get(breedId);
    for (const spellId of spellIds) target.add(spellId);
  }
  return byBreed;
}

export function normalizeDofusSpellCatalog({
  spellsPayload = {},
  levelsPayload = {},
  variantsPayload = {},
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
  const combatEffectRegistry = buildSpellEffectRegistry(effectsPayload, translationsPayload);
  const spells = releaseRecords(spellsPayload, 'SpellData');
  const levels = releaseRecords(levelsPayload, 'SpellLevelData');
  const variantsByBreed = variantIndex(variantsPayload);
  const breeds = releaseRecords(breedsPayload, 'BreedData')
    .filter((breed) => arrayField(breed.breedSpellsId).length || variantsByBreed.has(number(breed.id, -1)))
    .sort((a, b) => number(a.sortIndex, 0) - number(b.sortIndex, 0) || number(a.id, 0) - number(b.id, 0));

  const spellsById = new Map(spells.map((spell) => [number(spell.id, -1), spell]));
  const levelsById = new Map(levels.map((level) => [number(level.id, -1), level]));
  const normalizedSpells = [];
  const normalizedBreeds = [];
  const skipped = {};
  const modifierSamples = [];
  let classSpellRefs = 0;
  let variantSpellRefs = 0;
  let variantsCertified = 0;
  let offensiveCandidates = 0;
  let supportOnly = 0;
  let combatModifierSpells = 0;

  for (const breed of breeds) {
    const breedAnkamaId = number(breed.id, -1);
    const breedId = `breed-${breedAnkamaId}`;
    const breedName = translations[String(breed.shortNameId)] || `Classe #${breedAnkamaId}`;
    const breedSpellIds = [];
    const baseSpellIds = new Set(uniqueNumericIds(arrayField(breed.breedSpellsId)));
    const variantSpellIds = variantsByBreed.get(breedAnkamaId) || new Set();
    const sourceSpellIds = uniqueNumericIds([...baseSpellIds, ...variantSpellIds]);
    classSpellRefs += sourceSpellIds.length;
    variantSpellRefs += sourceSpellIds.filter((id) => variantSpellIds.has(id) && !baseSpellIds.has(id)).length;
    let breedCertified = 0;

    for (const spellId of sourceSpellIds) {
      const spell = spellsById.get(spellId);
      if (!spell) {
        skipped['missing-spell-record'] = (skipped['missing-spell-record'] || 0) + 1;
        continue;
      }
      const level = selectLevel(spell, levelsById, characterLevel);
      if (!level) {
        skipped['missing-level-200'] = (skipped['missing-level-200'] || 0) + 1;
        continue;
      }
      const result = normalizeOneSpell({ spell, level, breed, translations, combatEffectRegistry });
      if (result.hasKnownDamage) offensiveCandidates++;
      if (result.status !== 'certified') {
        skipped[result.reason] = (skipped[result.reason] || 0) + 1;
        continue;
      }
      result.spell.isVariant = variantSpellIds.has(spellId) && !baseSpellIds.has(spellId);
      if (result.spell.isVariant) variantsCertified++;
      if (result.spell.supportOnly) supportOnly++;
      if (result.spell.combatModifiers.length) {
        combatModifierSpells++;
        if (modifierSamples.length < 30) {
          modifierSamples.push({
            breed: breedName,
            spell: result.spell.name,
            variant: result.spell.isVariant,
            modifiers: result.spell.combatModifiers.map((modifier) => ({
              scope: modifier.scope,
              stats: modifier.stats,
              durationTurns: modifier.durationTurns,
              description: modifier.description
            }))
          });
        }
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
      sourceSpellCount: sourceSpellIds.length,
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
    model: 'direct-damage-and-deterministic-combat-effects',
    breeds: normalizedBreeds,
    spells: normalizedSpells,
    coverage: {
      breedCount: normalizedBreeds.length,
      classSpellRefs,
      variantSpellRefs,
      variantsCertified,
      offensiveCandidates,
      supportOnly,
      combatModifierSpells,
      certified: normalizedSpells.length,
      modifierSamples,
      skipped
    }
  };
}
