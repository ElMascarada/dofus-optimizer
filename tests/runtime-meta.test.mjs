import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

await import('../js/runtime-meta.js');
const { APP_VERSION } = await import('../js/config.js');

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const serviceWorker = await readFile(new URL('../service-worker.js', import.meta.url), 'utf8');
const sessionBridge = await readFile(new URL('../js/optimizer-session-bridge.js', import.meta.url), 'utf8');

test('runtime metadata is the canonical application version source', () => {
  assert.equal(globalThis.DofusOptimizerRuntime.appVersion, '0.14.2');
  assert.equal(APP_VERSION, globalThis.DofusOptimizerRuntime.appVersion);
  assert.equal(Object.hasOwn(packageJson, 'version'), false);
  assert.match(serviceWorker, /DofusOptimizerRuntime\.serviceWorkerCache/);
  assert.doesNotMatch(serviceWorker, /const CACHE = ['"]dofus-optimizer-v/);
});

test('search cache identifiers come from runtime metadata', () => {
  assert.equal(globalThis.DofusOptimizerRuntime.searchCache.storageKey, 'dofus-optimizer.search-cache.v1');
  assert.equal(globalThis.DofusOptimizerRuntime.searchCache.requiredItemsKey, 'dofus-optimizer.required-items.v1');
  assert.equal(globalThis.DofusOptimizerRuntime.searchCache.epoch, '20260825-required-gear-v1');
  assert.equal(globalThis.DofusOptimizerRuntime.searchCache.maxEntries, 12);
  assert.match(sessionBridge, /DofusOptimizerRuntime\?\.searchCache/);
  assert.doesNotMatch(sessionBridge, /const CACHE_STORAGE_KEY = ['"]dofus-optimizer\.search-cache/);
});
