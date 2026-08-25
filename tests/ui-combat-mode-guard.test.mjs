import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const serviceWorker = await readFile(new URL('../service-worker.js', import.meta.url), 'utf8');

test('primary UI exposes only the automatic combat solver', () => {
  assert.match(index, /<option value="combat" selected>Optimisation automatique · meilleur tour<\/option>/);
  assert.doesNotMatch(index, /<option value="manual">/);
  assert.match(index, /addEventListener\('click', forceAutomaticMode, true\)/);
  assert.match(index, /addEventListener\('pageshow', forceAutomaticMode\)/);
  assert.match(index, /AUTO ROTATION · build \d{8}-\d+/);
});

test('fresh service worker activates immediately', () => {
  assert.match(serviceWorker, /self\.skipWaiting\(\)/);
  assert.match(serviceWorker, /self\.clients\.claim\(\)/);
});
