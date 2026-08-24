import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const serviceWorker = await readFile(new URL('../service-worker.js', import.meta.url), 'utf8');

test('automatic combat mode is forced before a non-explicit solve', () => {
  assert.match(index, /manualExplicitlySelected/);
  assert.match(index, /addEventListener\('click', forceAutomaticMode, true\)/);
  assert.match(index, /addEventListener\('pageshow', forceAutomaticMode\)/);
});

test('fresh service worker activates immediately', () => {
  assert.match(serviceWorker, /self\.skipWaiting\(\)/);
  assert.match(serviceWorker, /self\.clients\.claim\(\)/);
});
