const CACHE = 'dofus-optimizer-v0.13.9';
const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './styles-experimental.css',
  './manifest.webmanifest',
  './data/normalized/dofus-data.json',
  './data/normalized/spell-data.json',
  './js/app-experimental.js',
  './js/spell-ui-enhancements.js',
  './js/config.js',
  './js/data-loader.js',
  './js/curated-runtime-rules.js',
  './js/item-availability.js',
  './js/spell-selection.js',
  './js/optimizer-worker.js',
  './js/result-diversity.js',
  './js/architecture-search.js',
  './js/architecture-search-v2.js',
  './js/offensive-slot-refiner.js',
  './js/combat-state.js',
  './js/turn-optimizer.js',
  './js/combat-turn-refiner.js',
  './js/spell-combat-effects.js',
  './js/set-synergy-index.js',
  './js/complete-build-evaluator.js',
  './js/candidate-prefilter.js',
  './js/solver.js',
  './js/search-space.js',
  './js/build-legality.js',
  './js/stats.js',
  './js/characteristics.js',
  './js/spells.js',
  './js/passives.js',
  './js/fm.js',
  './js/sets.js'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(APP_SHELL)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(Promise.all([
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))
    )),
    self.clients.claim()
  ]));
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(fetch(event.request).then((response) => {
    if (response.ok) {
      const copy = response.clone();
      caches.open(CACHE).then((cache) => cache.put(event.request, copy));
    }
    return response;
  }).catch(() => caches.match(event.request)));
});
