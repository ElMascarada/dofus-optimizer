import { searchEquipmentRequest } from './equipment-search-request.js';

const ALL_ELEMENTS = Object.freeze(['earth', 'fire', 'water', 'air']);

function normalizedIds(values = []) {
  return [...new Set((values || []).map((value) => String(value || '').trim()).filter(Boolean))].sort();
}

function canonicalSyntheticOffense(input = {}) {
  const raw = [...new Set((Array.isArray(input?.elements) ? input.elements : [input?.elements])
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean))];
  if (!raw.includes('omni')) return input || {};
  if (raw.length !== 1) throw new RangeError('Tous éléments est exclusif des autres sélections élémentaires.');
  return { ...input, elements: [...ALL_ELEMENTS] };
}

function cloneWorkspaceContext({ constraints = {}, fmPolicy = {}, syntheticOffense = {}, referenceScore = null } = {}) {
  return {
    constraints: { ...(constraints || {}) },
    fmPolicy: { ...(fmPolicy || {}) },
    syntheticOffense: {
      ...(syntheticOffense || {}),
      elements: [...(syntheticOffense?.elements || [])],
      profiles: [...(syntheticOffense?.profiles || [])]
    },
    referenceScore: Number.isFinite(Number(referenceScore)) ? Number(referenceScore) : null
  };
}

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'optimize') return;

  const { requestId, payload = {} } = event.data;
  try {
    const rejected = new Set(normalizedIds(payload.rejectedItemIds));
    const items = (payload.items || []).filter((item) => !rejected.has(String(item?.id)));
    const fmEnabled = payload.fmPolicy?.enabled === true || payload.fmPolicy?.fmEnabled === true;
    const constraints = { ...(payload.constraints || {}) };
    const fmPolicy = {
      enabled: fmEnabled,
      fmEnabled,
      exoAp: Number(payload.fmPolicy?.exoAp || 0) === 1 ? 1 : 0,
      exoMp: Number(payload.fmPolicy?.exoMp || 0) === 1 ? 1 : 0
    };
    const syntheticOffense = canonicalSyntheticOffense(payload.syntheticOffense || {});

    const output = searchEquipmentRequest({
      items,
      sets: payload.sets || [],
      constraints,
      fmPolicy,
      syntheticOffense,
      requiredItemIds: normalizedIds(payload.requiredItemIds),
      topN: Math.max(1, Number(payload.topN || 10)),
      searchProfile: payload.searchProfile || 'BALANCED',
      onProgress: (progress) => self.postMessage({ type: 'progress', requestId, progress })
    });

    output.results = (output.results || []).map((result) => ({
      ...result,
      workspaceContext: cloneWorkspaceContext({
        constraints,
        fmPolicy,
        syntheticOffense,
        referenceScore: result?.syntheticOffense?.minimumScore
      })
    }));

    self.postMessage({ type: 'result', requestId, output });
  } catch (error) {
    self.postMessage({
      type: 'error',
      requestId,
      message: error instanceof Error ? error.message : String(error)
    });
  }
});
