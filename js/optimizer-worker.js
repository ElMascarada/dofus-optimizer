import { optimizeBuild } from './solver.js';

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'optimize') return;
  const { requestId, payload } = event.data;

  try {
    const output = optimizeBuild({
      ...payload,
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
