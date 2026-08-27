import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const orchestrator = await readFile(new URL('../js/optimizer-v2-orchestrator.js', import.meta.url), 'utf8');
const serviceWorker = await readFile(new URL('../service-worker.js', import.meta.url), 'utf8');

test('primary UI exposes only the automatic combat solver', () => {
  assert.match(index, /id="optimizer-class"/);
  assert.match(index, /id="optimizer-element"/);
  assert.match(index, /id="optimizer-turn-mode"/);
  assert.match(index, /id="optimizer-run"/);
  assert.doesNotMatch(index, /value="manual"/);
  assert.doesNotMatch(index, /id="spell-list"/);
  assert.match(orchestrator, /objectiveMode: 'combat'/);
  assert.match(orchestrator, /searchProfile: 'BALANCED'/);
});

test('fresh service worker activates immediately', () => {
  assert.match(serviceWorker, /self\.skipWaiting\(\)/);
  assert.match(serviceWorker, /self\.clients\.claim\(\)/);
});
