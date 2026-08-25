import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const bridgeSource = await readFile(new URL('../js/optimizer-session-bridge.js', import.meta.url), 'utf8');
const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');

function bridgeApi() {
  class FakeWorker {
    addEventListener() {}
    postMessage() {}
  }
  const storage = new Map();
  const localStorage = {
    getItem: (key) => storage.has(key) ? storage.get(key) : null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key)
  };
  const document = {
    addEventListener() {},
    getElementById() { return null; },
    querySelectorAll() { return []; }
  };
  const window = { Worker: FakeWorker };
  vm.runInNewContext(bridgeSource, {
    window,
    document,
    localStorage,
    queueMicrotask,
    MessageEvent: class MessageEvent {},
    fetch: async () => ({ ok: false, status: 404 }),
    console,
    Map,
    Set,
    Object,
    Array,
    String,
    Number,
    Date,
    JSON,
    Math
  });
  return window.DofusOptimizerSession;
}

function payload(overrides = {}) {
  return {
    objectiveMode: 'combat',
    turnMode: 'sum',
    combatObjective: { element: 'earth', turnMode: 'sum', targetMode: 'single', metric: 'total-damage' },
    constraints: { ap: 12, mp: 6, vit: 6000, resEarth: 20 },
    fmPolicy: { spellDamagePct: 3, allowCritDamage: false },
    scenario: {},
    diversityMode: 'gear',
    topN: 10,
    selections: [],
    items: [{ id: 'item-a' }, { id: 'item-b' }],
    classSpells: [{ id: 'spell-a' }],
    requiredItemIds: [],
    ...overrides
  };
}

test('cache fingerprint is stable for identical searches and changes with constraints', () => {
  const api = bridgeApi();
  const base = api.cacheFingerprint(payload());
  assert.equal(base, api.cacheFingerprint(payload()));
  assert.notEqual(base, api.cacheFingerprint(payload({ constraints: { ap: 12, mp: 6, vit: 6100, resEarth: 20 } })));
  assert.notEqual(base, api.cacheFingerprint(payload({ combatObjective: { element: 'fire', turnMode: 'sum', targetMode: 'single', metric: 'total-damage' } })));
});

test('required equipment participates in the local cache key independent of id order', () => {
  const api = bridgeApi();
  const none = api.cacheFingerprint(payload());
  const harebourg = api.cacheFingerprint(payload({ requiredItemIds: ['item-14076', 'item-14077', 'item-14078'] }));
  const sameHarebourg = api.cacheFingerprint(payload({ requiredItemIds: ['item-14078', 'item-14076', 'item-14077'] }));
  assert.notEqual(none, harebourg);
  assert.equal(harebourg, sameHarebourg);
});

test('session bridge loads before stop bridge and the UI cache assets are wired', () => {
  const sessionIndex = index.indexOf('js/optimizer-session-bridge.js');
  const stopIndex = index.indexOf('js/optimizer-stop-bridge.js');
  assert.ok(sessionIndex >= 0);
  assert.ok(stopIndex > sessionIndex, 'session bridge must patch Worker before the stop bridge');
  assert.match(index, /styles-session\.css/);
  assert.match(bridgeSource, /5\. Équipement imposé/);
  assert.match(bridgeSource, /Panoplie du Comte Harebourg/);
  assert.match(bridgeSource, /output\?\.diagnostics\?\.stoppedEarly/);
});
