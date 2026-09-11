importScripts('./js/runtime-meta.js');

const CACHE = self.DofusOptimizerRuntime.serviceWorkerCache;
const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './styles-workshop.css',
  './styles-optimizer-v2.css',
  './styles-v2-polish.css',
  './styles-damage-truth.css',
  './manifest.webmanifest',
  './data/normalized/dofus-data.json',
  './data/normalized/spell-data.json',
  './js/runtime-meta.js',
  './js/optimizer-app.js',
  './js/optimizer-worker.js',
  './js/equipment-search-v2.js',
  './js/complete-equipment-build-evaluator.js',
  './js/synthetic-offense.js',
  './js/config.js',
  './js/data-loader.js',
  './js/curated-runtime-rules.js',
  './js/item-availability.js',
  './js/search-space.js',
  './js/build-legality.js',
  './js/stats.js',
  './js/characteristics.js',
  './js/sets.js',
  './optimizer/equipment-candidate-policy.js',
  './optimizer/search-profiles.js',
  './optimizer/item-eligibility.js',
  './optimizer/set-core-first-search.js',
  './optimizer/set-core-catalog.js',
  './js/workshop/workshop-app.js',
  './js/workshop/workshop-build.js',
  './js/workshop/workshop-events.js',
  './js/workshop/workshop-optimization.js',
  './js/spell-selection.js',
  './js/spell-combat-effects.js',
  './js/combat-state.js',
  './js/turn-optimizer.js',
  './js/spells.js',
  './js/passives.js',
  './js/fm.js'
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
