import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

await import('../js/runtime-meta.js');
const { APP_VERSION } = await import('../js/config.js');

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const serviceWorker = await readFile(new URL('../service-worker.js', import.meta.url), 'utf8');

test('runtime metadata is the canonical application version source', () => {
  assert.equal(globalThis.DofusOptimizerRuntime.appVersion, '0.14.7');
  assert.equal(APP_VERSION, globalThis.DofusOptimizerRuntime.appVersion);
  assert.equal(Object.hasOwn(packageJson, 'version'), false);
});

test('service worker cache identity comes from runtime metadata', () => {
  const cacheName = String(globalThis.DofusOptimizerRuntime.serviceWorkerCache || '');
  assert.ok(cacheName.startsWith(`dofus-optimizer-v${APP_VERSION}-`));
  assert.match(serviceWorker, /DofusOptimizerRuntime\.serviceWorkerCache/);
  assert.doesNotMatch(serviceWorker, /const CACHE = ['"]dofus-optimizer-v/);
});
