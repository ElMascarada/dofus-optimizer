export const OPTIMIZER_MESSAGE = Object.freeze({
  OPTIMIZE: 'optimize',
  PROGRESS: 'progress',
  RESULT: 'result',
  ERROR: 'error'
});

export function createOptimizeMessage(requestId, payload) {
  return {
    type: OPTIMIZER_MESSAGE.OPTIMIZE,
    requestId,
    payload
  };
}

export function optimizerMessageBelongsToRequest(message, requestId) {
  return message?.requestId === requestId;
}

export function isOptimizerProgress(message) {
  return message?.type === OPTIMIZER_MESSAGE.PROGRESS;
}

export function isOptimizerResult(message) {
  return message?.type === OPTIMIZER_MESSAGE.RESULT;
}

export function isOptimizerError(message) {
  return message?.type === OPTIMIZER_MESSAGE.ERROR;
}
