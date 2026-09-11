import { searchEquipmentArchitecturesV2 } from './equipment-search-v2.js';

function normalizedIds(values = []) {
  return [...new Set((values || []).map((value) => String(value || '').trim()).filter(Boolean))].sort();
}

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'optimize') return;

  const { requestId, payload = {} } = event.data;
  try {
    const rejected = new Set(normalizedIds(payload.rejectedItemIds));
    const items = (payload.items || []).filter((item) => !rejected.has(String(item?.id)));
    const fmEnabled = payload.fmPolicy?.enabled === true || payload.fmPolicy?.fmEnabled === true;

    const output = searchEquipmentArchitecturesV2({
      items,
      sets: payload.sets || [],
      constraints: payload.constraints || {},
      fmPolicy: {
        enabled: fmEnabled,
        fmEnabled,
        exoAp: Number(payload.fmPolicy?.exoAp || 0) === 1 ? 1 : 0,
        exoMp: Number(payload.fmPolicy?.exoMp || 0) === 1 ? 1 : 0
      },
      syntheticOffense: payload.syntheticOffense || {},
      requiredItemIds: normalizedIds(payload.requiredItemIds),
      topN: Math.max(1, Number(payload.topN || 10)),
      searchProfile: payload.searchProfile || 'BALANCED',
      onProgress: (progress) => self.postMessage({ type: 'progress', requestId, progress })
    });

    self.postMessage({ type: 'result', requestId, output });
  } catch (error) {
    self.postMessage({
      type: 'error',
      requestId,
      message: error instanceof Error ? error.message : String(error)
    });
  }
});
