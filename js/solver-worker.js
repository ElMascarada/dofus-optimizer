import { optimizeBuild } from './solver.js';

const DATA_URL = new URL('../data/normalized/dofus-data.json', import.meta.url);
let datasetPromise = null;

function summarize(dataset) {
  const bySlot = {};
  for (const item of dataset.items || []) bySlot[item.slot || 'unknown'] = (bySlot[item.slot || 'unknown'] || 0) + 1;
  return {
    schemaVersion: dataset.schemaVersion,
    gameVersion: dataset.gameVersion?.version || 'unknown',
    generatedAt: dataset.generatedAt || null,
    itemCount: dataset.items?.length || 0,
    setCount: dataset.sets?.length || 0,
    bySlot
  };
}

async function loadDataset() {
  const response = await fetch(DATA_URL, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`Impossible de charger le snapshot Dofus (${response.status}).`);
  const dataset = await response.json();
  if (!Array.isArray(dataset.items) || !Array.isArray(dataset.sets)) throw new Error('Snapshot Dofus invalide.');
  return dataset;
}

function dataset() {
  if (!datasetPromise) datasetPromise = loadDataset();
  return datasetPromise;
}

dataset()
  .then((value) => self.postMessage({ type: 'ready', summary: summarize(value) }))
  .catch((error) => self.postMessage({ type: 'error', message: error?.message || String(error) }));

self.addEventListener('message', async (event) => {
  const message = event.data || {};
  if (message.type !== 'optimize') return;
  const requestId = message.requestId;
  try {
    const data = await dataset();
    const output = optimizeBuild({
      items: data.items,
      sets: data.sets,
      ...message.payload,
      onProgress: (progress) => self.postMessage({ type: 'progress', requestId, progress })
    });
    self.postMessage({ type: 'result', requestId, output });
  } catch (error) {
    self.postMessage({ type: 'error', requestId, message: error?.stack || error?.message || String(error) });
  }
});
