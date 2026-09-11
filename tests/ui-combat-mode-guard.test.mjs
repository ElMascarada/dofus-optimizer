import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const serviceWorker = await readFile(new URL('../service-worker.js', import.meta.url), 'utf8');

test('primary UI exposes only the Equipment-First optimizer', () => {
  assert.match(index, /data-optimizer-element/);
  assert.match(index, /data-optimizer-profile/);
  assert.match(index, /id="optimizer-run"/);
  assert.match(index, /js\/optimizer-app\.js/);
  assert.doesNotMatch(index, /id="optimizer-class"|id="optimizer-turn-mode"|value="manual"|id="spell-list"/);
  assert.doesNotMatch(index, /js\/optimizer-v2-app\.js/);
});

test('fresh service worker activates immediately', () => {
  assert.match(serviceWorker, /self\.skipWaiting\(\)/);
  assert.match(serviceWorker, /self\.clients\.claim\(\)/);
});
