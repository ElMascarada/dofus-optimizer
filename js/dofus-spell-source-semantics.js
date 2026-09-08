import { normalizeSpellSourceTruth, releaseRecords } from './dofus-spell-source-truth.js';

function numericId(value, fallback = -1) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function compactSourceValue(value, depth = 0) {
  if (depth > 4) return '[nested-source-data]';
  if (Array.isArray(value)) return value.map((entry) => compactSourceValue(entry, depth + 1));
  if (Array.isArray(value?.Array)) return value.Array.map((entry) => compactSourceValue(entry, depth + 1));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, compactSourceValue(entry, depth + 1)]));
}

function translations(payload = {}) {
  const direct = payload?.entries && typeof payload.entries === 'object' ? payload.entries : {};
  if (Object.keys(direct).length) return direct;
  const langDatabase = releaseRecords(payload, 'LangDatabaseData')[0];
  if (!langDatabase) return {};
  return Object.fromEntries((langDatabase.entries?.Map || []).map((entry) => [
    String(numericId(entry?.key, -1)),
    String(entry?.value ?? '')
  ]));
}

function metadataIndex(payload = {}, normalizer = (record) => compactSourceValue(record)) {
  const records = releaseRecords(payload);
  const byId = new Map();
  for (const record of records) {
    const id = numericId(record?.id, -1);
    if (id < 0) continue;
    byId.set(id, normalizer(record));
  }
  return { records, byId };
}

function normalizeEffectMetadata(record = {}, i18n = {}) {
  const metadata = compactSourceValue(record);
  if (record.descriptionId !== undefined) {
    metadata.localizedDescription = i18n[String(record.descriptionId)] ?? null;
  }
  if (record.theoreticalDescriptionId !== undefined) {
    metadata.localizedTheoreticalDescription = i18n[String(record.theoreticalDescriptionId)] ?? null;
  }
  return metadata;
}

function enrichEffect(effect = {}, effectMetadataById = new Map()) {
  const effectId = numericId(effect.effectId);
  const effectMetadata = effectMetadataById.get(effectId) || null;
  return {
    ...effect,
    effectMetadata,
    metadataJoinStatus: effectMetadata ? 'joined' : 'missing',
    sourceDescription: effectMetadata?.localizedDescription ?? null
  };
}

function enrichBoundScript(usage = {}, scriptMetadataById = new Map()) {
  const scriptId = numericId(usage.scriptId, -1);
  const scriptMetadata = scriptMetadataById.get(scriptId) || null;
  return {
    ...usage,
    scriptMetadata,
    metadataJoinStatus: scriptMetadata ? 'joined' : 'missing'
  };
}

function joinedScriptMetadata(bound = []) {
  const seen = new Set();
  return bound.flatMap((usage) => {
    if (!usage.scriptMetadata || seen.has(usage.scriptId)) return [];
    seen.add(usage.scriptId);
    return [usage.scriptMetadata];
  });
}

function scriptJoinStatus(bound = []) {
  if (!bound.length) return 'not-applicable';
  const joined = bound.filter((usage) => usage.metadataJoinStatus === 'joined').length;
  if (joined === bound.length) return 'joined';
  return joined > 0 ? 'partial' : 'missing';
}

function withReason(entry, reason) {
  const reasons = new Set(entry.unresolvedReasons || []);
  reasons.add(reason);
  entry.unresolvedReasons = [...reasons];
  entry.semanticStatus = 'source-unresolved';
  if (entry.runtimeRepresentation) entry.runtimeRepresentation.fullyRepresentsSource = false;
}

export function enrichSpellSourceTruthMetadata({
  artifact,
  effectsPayload = {},
  scriptsPayload = {},
  translationsPayload = {}
} = {}) {
  if (!artifact || typeof artifact !== 'object') {
    throw new Error('Spell source metadata enrichment requires a normalized artifact.');
  }

  const output = structuredClone(artifact);
  const i18n = translations(translationsPayload);
  const effectMetadata = metadataIndex(effectsPayload, (record) => normalizeEffectMetadata(record, i18n));
  const scriptMetadata = metadataIndex(scriptsPayload);
  let effectMetadataMissing = 0;
  let scriptMetadataMissing = 0;

  for (const entry of output.spells || []) {
    entry.effects = (entry.effects || []).map((effect) => enrichEffect(effect, effectMetadata.byId));
    entry.criticalEffects = (entry.criticalEffects || []).map((effect) => enrichEffect(effect, effectMetadata.byId));

    const allEffects = [...entry.effects, ...entry.criticalEffects];
    const missingEffects = allEffects.filter((effect) => effect.metadataJoinStatus !== 'joined').length;
    effectMetadataMissing += missingEffects;
    if (missingEffects) withReason(entry, 'effect-metadata-not-found');

    const bound = (entry.scripts?.bound || []).map((usage) => enrichBoundScript(usage, scriptMetadata.byId));
    const missingScripts = bound.filter((usage) => usage.metadataJoinStatus !== 'joined').length;
    scriptMetadataMissing += missingScripts;
    if (missingScripts) withReason(entry, 'bound-script-metadata-not-found');

    entry.scripts = {
      ...(entry.scripts || {}),
      bound,
      standaloneMetadata: joinedScriptMetadata(bound),
      metadataJoinStatus: scriptJoinStatus(bound)
    };
  }

  output.schemaVersion = Math.max(numericId(output.schemaVersion, 1), 2);
  output.source = {
    ...(output.source || {}),
    rawAssetCounts: {
      ...(output.source?.rawAssetCounts || {}),
      effects: effectMetadata.records.length,
      spellScripts: scriptMetadata.records.length
    },
    effectMetadataJoin: 'effect-id',
    standaloneScriptMetadataJoin: 'script-id'
  };
  output.coverage = {
    ...(output.coverage || {}),
    effectMetadataMissing,
    scriptMetadataMissing
  };
  output.coverage.sourceUnresolved = (output.spells || [])
    .filter((entry) => entry.semanticStatus === 'source-unresolved').length;
  output.coverage.runtimeSupported = (output.spells || [])
    .filter((entry) => entry.semanticStatus === 'runtime-supported').length;

  return output;
}

export function normalizeSpellSourceTruthWithMetadata({
  effectsPayload = {},
  scriptsPayload = {},
  translationsPayload = {},
  ...sourceInput
} = {}) {
  const artifact = normalizeSpellSourceTruth({
    ...sourceInput,
    scriptsPayload,
    translationsPayload
  });
  return enrichSpellSourceTruthMetadata({
    artifact,
    effectsPayload,
    scriptsPayload,
    translationsPayload
  });
}
