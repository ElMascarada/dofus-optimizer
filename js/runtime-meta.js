const RUNTIME_META = Object.freeze({
  appVersion: '0.14.5',
  serviceWorkerCache: 'dofus-optimizer-v0.14.5-v2-final-ui-1',
  searchCache: Object.freeze({
    storageKey: 'dofus-optimizer.search-cache.v1',
    requiredItemsKey: 'dofus-optimizer.required-items.v1',
    epoch: '20260825-required-gear-v1',
    maxEntries: 12
  })
});

Object.defineProperty(globalThis, 'DofusOptimizerRuntime', {
  value: RUNTIME_META,
  configurable: true,
  enumerable: false,
  writable: false
});
