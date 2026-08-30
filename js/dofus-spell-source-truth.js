import { releaseRecords, translationEntries } from './dofus-spell-normalizer.js';
import { buildSpellEffectRegistry, extractDeterministicCombatModifiers } from './spell-combat-effects.js';

const FIXED_RUNTIME_DAMAGE_EFFECT_IDS = new Set([91, 92, 93, 94, 95, 96, 97, 98, 99, 100]);

const REQUIRED_UNRESOLVED_SEMANTICS = Object.freeze({
  Sentinelle: [
    {
      id: 'per-mp-used-reduction',
      status: 'unresolved',
      description: 'La réduction liée à chaque PM utilisé est conservée comme sémantique source non exécutée.'
    }
  ],
  'Tir Perçant': [
    {
      id: 'until-next-attack-consumption',
      status: 'unresolved',
      description: "La consommation jusqu'à la prochaine attaque reste une sémantique source non exécutée."
    }
  ],
  'Représailles': [
    {
      id: 'eroded-hp-formula',
      status: 'unresolved',
      description: 'La formule liée aux PV érodés reste une sémantique source non exécutée.'
    }
  ]
});

function arrayField(value) {
  return Array.isArray(value) ? value : Array.isArray(value?.Array) ? value.Array : [];
}

function finiteNumber(value, fallback = null) {
  if (value == null || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function numericId(value) {
  const parsed = finiteNumber(value, null);
  return parsed != null && parsed >= 0 ? parsed : null;
}

function uniqueNumbers(values = []) {
  return [...new Set(values.map(numericId).filter((value) => value != null))];
}

function compactScalarRecord(record = {}) {
  const output = {};
  for (const [key, value] of Object.entries(record || {})) {
    if (value == null || ['number', 'boolean'].includes(typeof value)) {
      output[key] = value;
      continue;
    }
    if (typeof value === 'string') {
      if (value.length <= 512 || /(?:id|type|trigger|name|description|event|hook|target|mask|duration|delay|zone|priority|order|family|pair)$/i.test(key)) {
        output[key] = value.length <= 2048 ? value : `${value.slice(0, 2048)}…`;
      }
      continue;
    }
    if (Array.isArray(value) && value.length <= 128 && value.every((entry) => entry == null || ['string', 'number', 'boolean'].includes(typeof entry))) {
      output[key] = value;
      continue;
    }
    if (Array.isArray(value?.Array) && value.Array.length <= 128 && value.Array.every((entry) => entry == null || ['string', 'number', 'boolean'].includes(typeof entry))) {
      output[key] = value.Array;
    }
  }
  return output;
}

function explicitRelationIds(record = {}, matcher) {
  const ids = [];
  const visit = (value, path = []) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry, path);
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      const childPath = [...path, key];
      if (matcher(key, childPath)) {
        if (Array.isArray(child)) ids.push(...child);
        else if (Array.isArray(child?.Array)) ids.push(...child.Array);
        else ids.push(child);
      }
      if (child && typeof child === 'object') visit(child, childPath);
    }
  };
  visit(record);
  return uniqueNumbers(ids);
}

function explicitSpellRelationIds(record = {}) {
  return explicitRelationIds(record, (key) => /spell.*ids?$/i.test(key) || /^spells?$/i.test(key));
}

function explicitStateRelationIds(record = {}) {
  return explicitRelationIds(record, (key) => /state.*ids?$/i.test(key) || /^states?$/i.test(key));
}

function assetSummary(payload = {}) {
  const records = releaseRecords(payload);
  return {
    recordCount: records.length,
    recordIds: uniqueNumbers(records.map((record) => record?.id)),
    records: records.map(compactScalarRecord)
  };
}

function buildReferenceIndex(payload = {}, relationExtractor = explicitSpellRelationIds) {
  const records = releaseRecords(payload);
  const byRelatedId = new Map();
  const compactById = new Map();

  records.forEach((record, index) => {
    const recordId = numericId(record?.id) ?? index;
    compactById.set(recordId, compactScalarRecord(record));
    for (const relatedId of relationExtractor(record)) {
      if (!byRelatedId.has(relatedId)) byRelatedId.set(relatedId, []);
      byRelatedId.get(relatedId).push(recordId);
    }
  });

  return {
    records,
    compactById,
    refsFor(id) {
      return [...(byRelatedId.get(numericId(id)) || [])];
    }
  };
}

function directOrRelatedRecordRefs(index, ids = []) {
  return uniqueNumbers(ids.flatMap((id) => [
    ...(index.compactById.has(numericId(id)) ? [numericId(id)] : []),
    ...index.refsFor(id)
  ]));
}

function effectMetadataRegistry(effectsPayload = {}, translationsPayload = {}) {
  const translations = translationEntries(translationsPayload);
  return new Map(releaseRecords(effectsPayload).map((meta) => {
    const id = numericId(meta?.id);
    return [id, {
      id,
      descriptionId: numericId(meta?.descriptionId),
      labelFr: translations[String(meta?.descriptionId)] ?? null,
      category: finiteNumber(meta?.category),
      useInFight: finiteNumber(meta?.useInFight),
      useDice: finiteNumber(meta?.useDice)
    }];
  }).filter(([id]) => id != null));
}

function isImmediateFixedRuntimeDamage(effect = {}) {
  const effectId = numericId(effect.effectId);
  if (!FIXED_RUNTIME_DAMAGE_EFFECT_IDS.has(effectId)) return false;
  const trigger = String(effect.triggers ?? 'I');
  const values = [effect.diceNum, effect.diceSide, effect.value].map((value) => finiteNumber(value, 0));
  return trigger === 'I'
    && finiteNumber(effect.duration, 0) === 0
    && finiteNumber(effect.delay, 0) === 0
    && finiteNumber(effect.random, 0) === 0
    && Math.max(...values) > 0;
}

function semanticClassification(effect, level, combatEffectRegistry) {
  const combat = extractDeterministicCombatModifiers([effect], combatEffectRegistry, level);
  if (isImmediateFixedRuntimeDamage(effect) || combat.modifiers.length > 0) {
    return {
      status: 'known-runtime',
      reason: isImmediateFixedRuntimeDamage(effect) ? 'fixed-immediate-runtime-damage' : 'deterministic-runtime-modifier'
    };
  }

  const stateRelations = explicitStateRelationIds(effect);
  if (stateRelations.length) {
    return { status: 'structural', reason: 'explicit-state-relation' };
  }

  return { status: 'unresolved', reason: 'not-executed-by-current-runtime' };
}

function normalizeZone(zone) {
  if (zone == null) return null;
  if (typeof zone !== 'object') return zone;
  const output = {};
  for (const [key, value] of Object.entries(zone)) {
    if (Array.isArray(value)) output[key] = value;
    else if (Array.isArray(value?.Array)) output[key] = value.Array;
    else if (value == null || ['string', 'number', 'boolean'].includes(typeof value)) output[key] = value;
  }
  return output;
}

function normalizeEffect(effect = {}, branch, index, level, effectMetaById, combatEffectRegistry) {
  const effectId = numericId(effect.effectId);
  const meta = effectMetaById.get(effectId) || null;
  const semantic = semanticClassification(effect, level, combatEffectRegistry);
  const stateRelations = explicitStateRelationIds(effect);
  const spellRelations = explicitSpellRelationIds(effect);

  return {
    branch,
    index,
    semanticStatus: semantic.status,
    semanticReason: semantic.reason,
    effectId,
    baseEffectId: numericId(effect.baseEffectId),
    effectUid: numericId(effect.effectUid),
    labelFr: meta?.labelFr ?? null,
    parameters: {
      diceNum: finiteNumber(effect.diceNum),
      diceSide: finiteNumber(effect.diceSide),
      value: finiteNumber(effect.value),
      random: finiteNumber(effect.random),
      group: finiteNumber(effect.group),
      modificator: finiteNumber(effect.modificator),
      order: finiteNumber(effect.order),
      effectElement: finiteNumber(effect.effectElement),
      effectTriggerDuration: finiteNumber(effect.effectTriggerDuration),
      displayZero: effect.displayZero ?? null,
      flags: effect.m_flags ?? null
    },
    duration: finiteNumber(effect.duration),
    delay: finiteNumber(effect.delay),
    trigger: effect.triggers ?? null,
    target: {
      id: numericId(effect.targetId),
      mask: effect.targetMask ?? null
    },
    zone: normalizeZone(effect.zoneDescr),
    dispellable: effect.dispellable ?? null,
    spellIdRelation: numericId(effect.spellId),
    spellRelations,
    stateRelations,
    otherIds: Object.fromEntries(
      Object.entries(effect)
        .filter(([key, value]) => /ids?$/i.test(key) && value != null)
        .map(([key, value]) => [key, Array.isArray(value?.Array) ? value.Array : value])
    ),
    sourceMetadata: meta
  };
}

function variantRelations(variantsPayload = {}) {
  const records = releaseRecords(variantsPayload);
  const byBreed = new Map();
  const bySpell = new Map();

  records.forEach((record, index) => {
    const breedId = numericId(record?.breedId ?? record?.breed_id ?? record?.breed?.id ?? record?.breed ?? record?.id);
    const spellIds = uniqueNumbers(arrayField(
      record?.spellIds
      ?? record?.spell_ids
      ?? record?.spells
      ?? record?.variants
      ?? record?.spellVariants
    ));
    if (breedId != null && spellIds.length) {
      if (!byBreed.has(breedId)) byBreed.set(breedId, new Set());
      for (const spellId of spellIds) byBreed.get(breedId).add(spellId);
    }
    const sourceRecordId = numericId(record?.id) ?? index;
    for (const spellId of spellIds) {
      if (!bySpell.has(spellId)) bySpell.set(spellId, []);
      bySpell.get(spellId).push({ sourceRecordId, spellIds });
    }
  });

  return { byBreed, bySpell };
}

function explicitCastingFlags(level = {}) {
  const candidates = [
    'castInLine',
    'castInDiagonal',
    'castTestLos',
    'needLos',
    'needsLos',
    'rangeCanBeBoosted',
    'rangeCanBeModified',
    'canCastInLine',
    'canCastInDiagonal'
  ];
  return Object.fromEntries(candidates.filter((key) => Object.prototype.hasOwnProperty.call(level, key)).map((key) => [key, level[key]]));
}

function sourcePresence(spell) {
  if (!spell) return 'ABSENT_FROM_SOURCE';
  const hasUnresolved = spell.semanticNotes?.some((entry) => entry.status === 'unresolved')
    || spell.levels.some((level) => [...level.effects.normal, ...level.effects.critical].some((effect) => effect.semanticStatus === 'unresolved'));
  return hasUnresolved ? 'PRESENT_BUT_UNRESOLVED' : 'PRESENT_FROM_SOURCE';
}

export function normalizeDofusSpellSourceTruth({
  spellsPayload = {},
  levelsPayload = {},
  variantsPayload = {},
  breedsPayload = {},
  effectsPayload = {},
  translationsPayload = {},
  spellPairsPayload = {},
  spellScriptsPayload = {},
  spellStatesPayload = {},
  spellTypesPayload = {},
  gameVersion = {},
  generatedAt = null
} = {}) {
  const translations = translationEntries(translationsPayload);
  const spells = releaseRecords(spellsPayload, 'SpellData');
  const levels = releaseRecords(levelsPayload, 'SpellLevelData');
  const breeds = releaseRecords(breedsPayload, 'BreedData');
  const levelsById = new Map(levels.map((level) => [numericId(level.id), level]).filter(([id]) => id != null));
  const spellsById = new Map(spells.map((spell) => [numericId(spell.id), spell]).filter(([id]) => id != null));
  const variant = variantRelations(variantsPayload);
  const effectMetaById = effectMetadataRegistry(effectsPayload, translationsPayload);
  const combatEffectRegistry = buildSpellEffectRegistry(effectsPayload, translationsPayload);
  const pairIndex = buildReferenceIndex(spellPairsPayload);
  const scriptIndex = buildReferenceIndex(spellScriptsPayload);
  const stateIndex = buildReferenceIndex(spellStatesPayload, explicitStateRelationIds);
  const typeIndex = buildReferenceIndex(spellTypesPayload, (record) => explicitRelationIds(record, (key) => /type.*ids?$/i.test(key)));

  const normalizedSpells = [];
  const breedRows = [];
  const seenSpellIds = new Set();

  for (const breed of breeds) {
    const breedId = numericId(breed.id);
    if (breedId == null) continue;
    const baseSpellIds = new Set(uniqueNumbers(arrayField(breed.breedSpellsId)));
    const variantSpellIds = variant.byBreed.get(breedId) || new Set();
    const sourceSpellIds = uniqueNumbers([...baseSpellIds, ...variantSpellIds]);
    if (!sourceSpellIds.length) continue;

    const breedNameFr = translations[String(breed.shortNameId)] ?? `Classe #${breedId}`;
    const breedSpellIds = [];

    for (const spellId of sourceSpellIds) {
      if (seenSpellIds.has(spellId)) continue;
      const spell = spellsById.get(spellId);
      if (!spell) continue;
      const spellLevels = arrayField(spell.spellLevels)
        .map((levelId) => levelsById.get(numericId(levelId)))
        .filter(Boolean)
        .sort((a, b) => finiteNumber(a.grade, 0) - finiteNumber(b.grade, 0) || finiteNumber(a.minPlayerLevel, 0) - finiteNumber(b.minPlayerLevel, 0));

      const nameFr = translations[String(spell.nameId)] ?? `Sort #${spellId}`;
      const normalizedLevels = spellLevels.map((level) => {
        const normalEffects = arrayField(level.effects).map((effect, index) => normalizeEffect(effect, 'normal', index, level, effectMetaById, combatEffectRegistry));
        const criticalEffects = arrayField(level.criticalEffect).map((effect, index) => normalizeEffect(effect, 'critical', index, level, effectMetaById, combatEffectRegistry));
        const stateIds = uniqueNumbers([...normalEffects, ...criticalEffects].flatMap((effect) => effect.stateRelations));

        return {
          spellLevelId: numericId(level.id),
          grade: finiteNumber(level.grade),
          minPlayerLevel: finiteNumber(level.minPlayerLevel),
          casting: {
            apCost: finiteNumber(level.apCost),
            minRange: finiteNumber(level.minRange),
            maxRange: finiteNumber(level.range),
            criticalHitProbability: finiteNumber(level.criticalHitProbability),
            maxCastPerTurn: finiteNumber(level.maxCastPerTurn),
            maxCastPerTarget: finiteNumber(level.maxCastPerTarget),
            globalCooldown: finiteNumber(level.globalCooldown),
            cooldown: finiteNumber(level.minCastInterval ?? level.minCastIntervalTurns),
            initialCooldown: finiteNumber(level.initialCooldown ?? level.initialCooldownTurns),
            zone: normalizeZone(level.previewZones),
            flags: explicitCastingFlags(level),
            rawFlags: level.m_flags ?? null,
            statesCriterion: level.statesCriterion ?? null
          },
          effects: { normal: normalEffects, critical: criticalEffects },
          sourceRefs: {
            stateIds,
            stateRecordIds: directOrRelatedRecordRefs(stateIndex, stateIds)
          }
        };
      });

      const typeIds = uniqueNumbers([
        spell.typeId,
        spell.spellTypeId,
        spell.spellType,
        ...explicitRelationIds(spell, (key) => /type.*ids?$/i.test(key))
      ]);
      const pairRefs = pairIndex.refsFor(spellId);
      const scriptRefs = scriptIndex.refsFor(spellId);

      normalizedSpells.push({
        identity: {
          spellId,
          breedId,
          breedNameFr,
          isVariant: variantSpellIds.has(spellId) && !baseSpellIds.has(spellId),
          variantRelation: variant.bySpell.get(spellId) || [],
          typeIds,
          pairFamilyRefs: pairRefs
        },
        text: {
          nameFr,
          descriptionFr: translations[String(spell.descriptionId)] ?? null
        },
        sourceRefs: {
          spellPairRecordIds: pairRefs,
          spellScriptRecordIds: scriptRefs,
          spellTypeRecordIds: directOrRelatedRecordRefs(typeIndex, typeIds)
        },
        semanticNotes: REQUIRED_UNRESOLVED_SEMANTICS[nameFr] ? structuredClone(REQUIRED_UNRESOLVED_SEMANTICS[nameFr]) : [],
        levels: normalizedLevels
      });
      seenSpellIds.add(spellId);
      breedSpellIds.push(spellId);
    }

    breedRows.push({ breedId, nameFr: breedNameFr, sourceSpellIds: breedSpellIds });
  }

  const allEffects = normalizedSpells.flatMap((spell) => spell.levels.flatMap((level) => [...level.effects.normal, ...level.effects.critical]));
  const counts = allEffects.reduce((acc, effect) => {
    if (effect.semanticStatus === 'known-runtime') acc.runtimeKnownEffectCount++;
    else if (effect.semanticStatus === 'structural') acc.structuralOnlyEffectCount++;
    else acc.unresolvedEffectCount++;
    return acc;
  }, {
    runtimeKnownEffectCount: 0,
    structuralOnlyEffectCount: 0,
    unresolvedEffectCount: 0
  });

  const requiredProbeNames = ['Tirs Puissants', 'Sentinelle', 'Tir Perçant', 'Représailles'];
  const probes = requiredProbeNames.map((name) => {
    const spell = normalizedSpells.find((entry) => entry.text.nameFr === name) || null;
    return {
      name,
      spellId: spell?.identity?.spellId ?? null,
      status: sourcePresence(spell)
    };
  });

  return {
    schemaVersion: 1,
    model: 'spell-source-truth',
    source: {
      provider: 'Dofusdude',
      gameVersion,
      generatedAt: generatedAt ?? gameVersion?.update_stamp ?? null
    },
    semantics: {
      importerActivatesRuntime: false,
      statuses: {
        'known-runtime': 'Effet dont la mécanique individuelle est déjà comprise par le runtime actuel.',
        structural: 'Relation structurelle source conservée mais non exécutée comme mécanique de combat.',
        unresolved: 'Donnée source présente mais non jouée par le moteur actuel.'
      },
      unknownEffectsActivateCombat: false,
      scriptsOrTriggersInterpretedSilently: false
    },
    coverage: {
      spellCount: normalizedSpells.length,
      spellLevelCount: normalizedSpells.reduce((sum, spell) => sum + spell.levels.length, 0),
      effectInstanceCount: allEffects.length,
      ...counts,
      additionalAssetsLoaded: {
        spell_pairs: pairIndex.records.length,
        spell_scripts: scriptIndex.records.length,
        spell_states: stateIndex.records.length,
        spell_types: typeIndex.records.length
      },
      sourcePresenceStates: ['ABSENT_FROM_SOURCE', 'PRESENT_FROM_SOURCE', 'PRESENT_BUT_UNRESOLVED'],
      requiredProbes: probes
    },
    references: {
      spellPairs: assetSummary(spellPairsPayload),
      spellScripts: assetSummary(spellScriptsPayload),
      spellStates: assetSummary(spellStatesPayload),
      spellTypes: assetSummary(spellTypesPayload)
    },
    breeds: breedRows,
    spells: normalizedSpells
  };
}
