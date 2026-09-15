const RUNTIME_META = Object.freeze({
  appVersion: '0.14.11',
  serviceWorkerCache: 'dofus-optimizer-v0.14.11-constraint-ux-1'
});

Object.defineProperty(globalThis, 'DofusOptimizerRuntime', {
  value: RUNTIME_META,
  configurable: true,
  enumerable: false,
  writable: false
});
