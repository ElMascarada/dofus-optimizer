const RUNTIME_META = Object.freeze({
  appVersion: '0.14.7',
  serviceWorkerCache: 'dofus-optimizer-v0.14.7-clean-baseline-1'
});

Object.defineProperty(globalThis, 'DofusOptimizerRuntime', {
  value: RUNTIME_META,
  configurable: true,
  enumerable: false,
  writable: false
});
