(() => {
  const marker = 'dofus-optimizer.cache-migration.20260825-hard-survivability';
  const storageKey = globalThis.DofusOptimizerRuntime?.searchCache?.storageKey;
  try {
    if (localStorage.getItem(marker) === 'done') return;
    if (storageKey) localStorage.removeItem(storageKey);
    localStorage.setItem(marker, 'done');
  } catch {
    // Cache migration must never prevent the optimizer from starting.
  }
})();
