(() => {
  const marker = 'dofus-optimizer.cache-migration.20260825-iop-multiturn';
  try {
    if (localStorage.getItem(marker) === 'done') return;
    localStorage.removeItem('dofus-optimizer.search-cache.v1');
    localStorage.setItem(marker, 'done');
  } catch {
    // Cache migration must never prevent the optimizer from starting.
  }
})();
