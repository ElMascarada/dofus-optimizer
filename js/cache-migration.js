(() => {
  const MARKER_KEY = 'dofus-optimizer.cache-migration';
  const MARKER_VALUE = '20260825-strict-defense-plans-v1';
  const SEARCH_CACHE_KEY = 'dofus-optimizer.search-cache.v1';

  try {
    if (localStorage.getItem(MARKER_KEY) === MARKER_VALUE) return;
    localStorage.removeItem(SEARCH_CACHE_KEY);
    localStorage.setItem(MARKER_KEY, MARKER_VALUE);
  } catch {
    // Storage can be unavailable in private/restricted modes. The solver still works.
  }
})();
