const RUNTIME_FIXED_DAMAGE_EFFECT_IDS = new Set([91, 92, 93, 94, 95, 96, 97, 98, 99, 100]);
const EXPLICIT_PAIR_ID_FIELDS = [
  'spellId', 'spellIds', 'firstSpellId', 'secondSpellId', 'spellId1', 'spellId2',
  'baseSpellId', 'variantSpellId', 'leftSpellId', 'rightSpellId'
];

function arrayField(value) {
  return Array.isArray(value) ? value : Array.isArray(value?.Array) ? value.Array : [];
}

function numericId(value, fallback = -1) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function maybeNumber(value) {
  if (value === null || value === undefined || value === '') return value ?? null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : value;
}

function uniqueNumericIds(values = []) {
  const seen = new Set();
  const output = [];
  for (const raw of values) {
    const id = numericId(raw, -1);
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

function translations(payload = {}) {
  return payload?.entries && typeof payload.entries === 'object' ? payload.entries : {};
}

function selectLevel(spell = {}, levelsById = new Map(), characterLevel = 200) {
  return arrayField(spell.spellLevels)
    .map((id) => levelsById.get(numericId(id)))
    .filter((level) => level && numericId(level.minPlayerLevel, 0) <= characterLevel)
    .sort((a, b) => numericId(b.minPlayerLevel, 0) - numericId(a.minPlayerLevel, 0)
      || numericId(b.grade, 0) - numericId(a.grade, 0)
      || numericId(b.id, 0) - numericId(a.id, 0))[0] || null;
}

function variantIndex(variantsPayload = {}) {
  const byBreed = new Map();
  for (const variant of releaseRecords(variantsPayload)) {
    const breedId = numericId(
      variant?.breedId ?? variant?.breed_id ?? variant?.breed?.id ?? variant?.breed ?? variant?.id,
      -1
    );
    if (breedId < 0) continue;
    const spellIds = uniqueNumericIds(arrayField(
      variant?.spellIds ?? variant?.spell_ids ?? variant?.spells ?? variant?.variants ?? variant?.spellVariants
    ));
    if (!spellIds.length) continue;
    if (!byBreed.has(breedId)) byBreed.set(breedId, new Set());
    for (const id of spellIds) byBreed.get(breedId).add(id);
  }
  return byBreed;
}

function compactSourceValue(value, depth = 0) {
  if (depth > 4) return '[nested-source-data]';
  if (Array.isArray(value)) return value.map((entry) => compactSourceValue(entry, depth + 1));
  if (Array.isArray(value?.Array)) return value.Array.map((entry) => compactSourceValue(entry, depth + 1));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, compactSourceValue(entry, depth + 1)]));
}

function normalizeEffect(effect = {}) {
  return {
    effectId: numericId(effect.effectId),
    order: numericId(effect.order, 0),
    triggers: String(effect.triggers ?? 'I'),
    duration: numericId(effect.duration, 0),
    delay: numericId(effect.delay, 0),
    targetMask: effect.targetMask ?? null,
    diceNum: maybeNumber(effect.diceNum ?? null),
    diceSide: maybeNumber(effect.diceSide ?? null),
    value: maybeNumber(effect.value ?? null),
    zoneDescr: effect.zoneDescr ?? null,
    random: numericId(effect.random, 0),
    randomGroup: numericId(effect.randomGroup, 0),
    group: numericId(effect.group, 0)
  };
}

function normalizeBoundScriptUsage(entry = {}) {
  const preferred = [
    'scriptId', 'activationMask', 'activationZone', 'casterMask', 'criterion', 'order',
    'random', 'randomGroup', 'sequenceGroup', 'targetMask', 'targetZone'
  ];
  const output = {};
  for (const key of preferred) {
    if (entry[key] !== undefined) output[key] = compactSourceValue(entry[key]);
  }
  for (const [key, value] of Object.entries(entry)) {
    if (output[key] !== undefined) continue;
    if (value === undefined) continue;
    output[key] = compactSourceValue(value);
  }
  if (output.scriptId !== undefined) output.scriptId = numericId(output.scriptId);
  if (output.order !== undefined) output.order = numericId(output.order, 0);
  return output;
}

function collectStateReferences(value, path = '', output = []) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectStateReferences(entry, `${path}[${index}]`, output));
    return output;
  }
  if (Array.isArray(value?.Array)) {
    value.Array.forEach((entry, index) => collectStateReferences(entry, `${path}.Array[${index}]`, output));
    return output;
  }
  if (!value || typeof value !== 'object') return output;

  for (const [key, child] of Object.entries(value)) {
    const childPath = path ? `${path}.${key}` : key;
    if (/state(?:Id|Ids)$/i.test(key)) {
      const rawIds = arrayField(child).length ? arrayField(child) : (Array.isArray(child) ? child : [child]);
      const ids = uniqueNumericIds(rawIds);
      if (ids.length) output.push({ path: childPath, ids });
      continue;
    }
    collectStateReferences(child, childPath, output);
  }
  return output;
}

function explicitPairSpellIds(record = {}) {
  const ids = [];
  for (const key of EXPLICIT_PAIR_ID_FIELDS) {
    if (!(key in record)) continue;
    const value = record[key];
    if (Array.isArray(value) || Array.isArray(value?.Array)) ids.push(...arrayField(value));
    else ids.push(value);
  }
  return uniqueNumericIds(ids);
}

function normalizePairRecord(record = {}) {
  const spellIds = explicitPairSpellIds(record);
  if (!spellIds.length) return null;
  return {
    id: numericId(record.id, -1),
    spellIds,
    source: compactSourceValue(record)
  };
}

function pairIndex(pairPayload = {}) {
  const records = releaseRecords(pairPayload);
  const normalized = records.map(normalizePairRecord).filter(Boolean);
  const bySpell = new Map();
  for (const pair of normalized) {
    for (const spellId of pair.spellIds) {
      if (!bySpell.has(spellId)) bySpell.set(spellId, []);
      bySpell.get(spellId).push(pair);
    }
  }
  return { records, normalized, bySpell };
}

function normalizeLevel(level = {}) {
  const targetingKeys = [
    'minRange', 'range', 'castInLine', 'castInDiagonal', 'castTestLos', 'rangeCanBeBoosted',
    'needFreeCell', 'needTakenCell', 'needFreeTrapCell', 'maxCastPerTurn', 'maxCastPerTarget',
    'minCastInterval', 'minCastIntervalTurns', 'initialCooldown', 'initialCooldownTurns',
    'globalCooldown', 'criticalHitProbability'
  ];
  const targeting = {};
  for (const key of targetingKeys) {
    if (level[key] !== undefined) targeting[key] = compactSourceValue(level[key]);
  }
  return {
    id: numericId(level.id),
    grade: numericId(level.grade, 0),
    minPlayerLevel: numericId(level.minPlayerLevel, 0),
    apCost: numericId(level.apCost, 0),
    minRange: numericId(level.minRange, 0),
    maxRange: numericId(level.range, numericId(level.minRange, 0)),
    targeting
  };
}

function allEffects(entry) {
  return [...entry.effects, ...entry.criticalEffects];
}

function hasNonImmediateTrigger(entry) {
  return allEffects(entry).some((effect) => effect.triggers !== 'I');
}

function runtimeCanFullyRepresent(entry, runtimeSpell) {
  if (!runtimeSpell) return false;
  if (entry.scripts.bound.length) return false;
  if (entry.stateReferences.length) return false;
  const effects = allEffects(entry);
  if (!effects.length) return false;
  if (effects.some((effect) => effect.triggers !== 'I' || effect.delay !== 0 || effect.duration !== 0 || effect.random !== 0)) return false;
  if (effects.some((effect) => !RUNTIME_FIXED_DAMAGE_EFFECT_IDS.has(effect.effectId))) return false;
  const sourceNormal = entry.effects.length;
  const sourceCritical = entry.criticalEffects.length;
  const runtimeHits = Array.isArray(runtimeSpell.hits) ? runtimeSpell.hits.length : 0;
  if (sourceNormal !== runtimeHits) return false;
  if (sourceCritical && sourceCritical !== runtimeHits) return false;
  return true;
}

function unresolvedReasons(entry, runtimeSpell) {
  const reasons = [];
  if (!runtimeSpell) reasons.push('absent-from-runtime-combat-catalog');
  if (entry.scripts.bound.length) reasons.push('bound-script-semantics-not-certified');
  if (hasNonImmediateTrigger(entry)) reasons.push('non-immediate-trigger-semantics-not-certified');
  if (allEffects(entry).some((effect) => effect.delay !== 0)) reasons.push('delayed-effect-semantics-not-certified');
  if (entry.stateReferences.length) reasons.push('state-semantics-not-certified');
  if (allEffects(entry).some((effect) => effect.random !== 0)) reasons.push('random-effect-semantics-not-certified');
  if (runtimeSpell && allEffects(entry).some((effect) => !RUNTIME_FIXED_DAMAGE_EFFECT_IDS.has(effect.effectId))) {
    reasons.push('source-effects-exceed-runtime-model');
  }
  if (runtimeSpell && !reasons.length && !runtimeCanFullyRepresent(entry, runtimeSpell)) {
    reasons.push('source-effect-shape-not-fully-represented');
  }
  return [...new Set(reasons)];
}

function typeIndex(typesPayload = {}, i18n = {}) {
  return new Map(releaseRecords(typesPayload).map((type) => {
    const id = numericId(type.id);
    return [id, {
      id,
      longName: i18n[String(type.longNameId)] ?? null,
      shortName: i18n[String(type.shortNameId)] ?? null
    }];
  }));
}

export function normalizeSpellSourceTruth({
  spellsPayload = {},
  levelsPayload = {},
  variantsPayload = {},
  breedsPayload = {},
  pairsPayload = {},
  scriptsPayload = {},
  statesPayload = {},
  typesPayload = {},
  translationsPayload = {},
  runtimeCatalog = {},
  gameVersion = {},
  generatedAt = null,
  characterLevel = 200
} = {}) {
  const i18n = translations(translationsPayload);
  const sourceSpells = releaseRecords(spellsPayload, 'SpellData');
  const levels = releaseRecords(levelsPayload, 'SpellLevelData');
  const levelsById = new Map(levels.map((level) => [numericId(level.id), level]));
  const spellsById = new Map(sourceSpells.map((spell) => [numericId(spell.id), spell]));
  const variantsByBreed = variantIndex(variantsPayload);
  const pairs = pairIndex(pairsPayload);
  const typesById = typeIndex(typesPayload, i18n);
  const runtimeById = new Map((runtimeCatalog?.spells || []).map((spell) => [numericId(spell.ankamaId), spell]));
  const breeds = releaseRecords(breedsPayload, 'BreedData')
    .filter((breed) => arrayField(breed.breedSpellsId).length || variantsByBreed.has(numericId(breed.id)))
    .sort((a, b) => numericId(a.sortIndex, 0) - numericId(b.sortIndex, 0) || numericId(a.id, 0) - numericId(b.id, 0));

  const emittedById = new Map();
  for (const breed of breeds) {
    const breedId = numericId(breed.id);
    const breedName = i18n[String(breed.shortNameId)] || `Classe #${breedId}`;
    const baseSpellIds = new Set(uniqueNumericIds(arrayField(breed.breedSpellsId)));
    const variantSpellIds = variantsByBreed.get(breedId) || new Set();
    const sourceSpellIds = uniqueNumericIds([...baseSpellIds, ...variantSpellIds]);

    for (const spellId of sourceSpellIds) {
      const spell = spellsById.get(spellId);
      if (!spell) continue;
      const level = selectLevel(spell, levelsById, characterLevel);
      if (!level) continue;
      const typeId = numericId(spell.typeId, -1);
      const boundScripts = arrayField(spell.boundScriptUsageData).map(normalizeBoundScriptUsage);
      const effects = arrayField(level.effects).map(normalizeEffect).sort((a, b) => a.order - b.order);
      const criticalEffects = arrayField(level.criticalEffect).map(normalizeEffect).sort((a, b) => a.order - b.order);
      const stateReferences = collectStateReferences({ spell, level });
      const pairRelationships = (pairs.bySpell.get(spellId) || []).map((pair) => ({
        id: pair.id,
        spellIds: pair.spellIds,
        source: pair.source
      }));
      const runtimeSpell = runtimeById.get(spellId) || null;
      const entry = {
        id: spellId,
        name: i18n[String(spell.nameId)] || `Sort #${spellId}`,
        breed: { id: breedId, name: breedName },
        order: numericId(spell.order, 0),
        iconId: numericId(spell.iconId, 0),
        type: typesById.get(typeId) || { id: typeId, longName: null, shortName: null },
        relationships: {
          variant: variantSpellIds.has(spellId) && !baseSpellIds.has(spellId),
          pairRelationships
        },
        level: normalizeLevel(level),
        effects,
        criticalEffects,
        scripts: {
          bound: boundScripts,
          standaloneMetadata: null,
          metadataJoinStatus: boundScripts.length ? 'source-unresolved' : 'not-applicable'
        },
        stateReferences,
        semanticStatus: 'source-unresolved',
        unresolvedReasons: [],
        runtimeRepresentation: {
          presentInCombatCatalog: Boolean(runtimeSpell),
          fullyRepresentsSource: false,
          sourceTruthConsumedByRuntime: false
        }
      };
      const supported = runtimeCanFullyRepresent(entry, runtimeSpell);
      entry.semanticStatus = supported ? 'runtime-supported' : 'source-unresolved';
      entry.runtimeRepresentation.fullyRepresentsSource = supported;
      entry.unresolvedReasons = supported ? [] : unresolvedReasons(entry, runtimeSpell);
      emittedById.set(spellId, entry);
    }
  }

  const emitted = [...emittedById.values()].sort((a, b) => a.breed.id - b.breed.id || a.order - b.order || a.id - b.id);
  const runtimeSupported = emitted.filter((entry) => entry.semanticStatus === 'runtime-supported').length;
  const sourceUnresolved = emitted.length - runtimeSupported;
  const withScripts = emitted.filter((entry) => entry.scripts.bound.length > 0).length;
  const withTriggers = emitted.filter(hasNonImmediateTrigger).length;
  const withStates = emitted.filter((entry) => entry.stateReferences.length > 0).length;

  return {
    schemaVersion: 1,
    source: {
      provider: 'Dofusdude/dofus3-main',
      game: 'dofus3',
      language: 'fr',
      gameVersion,
      generatedAt,
      characterLevel,
      scope: 'player-class-spells',
      rawAssetCounts: {
        spells: sourceSpells.length,
        spellLevels: levels.length,
        spellPairs: pairs.records.length,
        spellScripts: releaseRecords(scriptsPayload).length,
        spellStates: releaseRecords(statesPayload).length,
        spellTypes: releaseRecords(typesPayload).length
      },
      pairRelationshipJoin: pairs.records.length && !pairs.normalized.length ? 'source-unresolved' : 'explicit-id-fields-only',
      standaloneScriptMetadataJoin: 'source-unresolved'
    },
    semanticStatusContract: {
      'runtime-supported': 'The complete selected source effect shape is already represented by the existing runtime combat catalog.',
      'source-unresolved': 'Rich source semantics are preserved here but are not fully certified by the existing runtime and remain inactive.'
    },
    coverage: {
      sourceSpellCount: sourceSpells.length,
      entriesEmitted: emitted.length,
      runtimeSupported,
      sourceUnresolved,
      withScripts,
      withTriggers,
      withStates
    },
    spells: emitted
  };
}
