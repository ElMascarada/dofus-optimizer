const CACHE = 'dofus-optimizer-v0.10.2';
const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './data/normalized/dofus-data.json',
  './data/normalized/spell-data.json',
  './js/app.js',
  './js/config.js',
  './js/data-loader.js',
  './js/spell-selection.js',
  './js/optimizer-worker.js',
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
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(APP_SHELL)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))
  )));
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(fetch(event.request).then((response) => {
    const copy = response.clone();
    caches.open(CACHE).then((cache) => cache.put(event.request, copy));
    return response;
  }).catch(() => caches.match(event.request)));
});
