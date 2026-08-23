const CACHE = 'dofus-optimizer-v0.7.0';
const APP_SHELL = [
  './', './index.html', './styles.css', './manifest.webmanifest',
  './data/normalized/dofus-data.json',
  './js/config.js', './js/stats.js', './js/characteristics.js', './js/spells.js',
  './js/fm.js', './js/sets.js', './js/passives.js', './js/build-legality.js',
  './js/search-space.js', './js/solver.js', './js/solver-worker.js', './js/sample-data.js', './js/app.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(APP_SHELL)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))));
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(fetch(event.request).then((response) => {
    const copy = response.clone();
    caches.open(CACHE).then((cache) => cache.put(event.request, copy));
    return response;
  }).catch(() => caches.match(event.request)));
});
