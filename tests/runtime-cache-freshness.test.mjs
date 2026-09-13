import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('runtime cache version follows the active app version', async () => {
  const source = await read('js/runtime-meta.js');
  const version = source.match(/appVersion:\s*'([^']+)'/)?.[1];
  const cache = source.match(/serviceWorkerCache:\s*'([^']+)'/)?.[1];

  assert.ok(version, 'appVersion must be declared');
  assert.ok(cache, 'serviceWorkerCache must be declared');
  assert.match(cache, new RegExp(`v${version.replaceAll('.', '\\.')}`));
});

test('service worker precaches the active combined optimizer runtime', async () => {
  const source = await read('service-worker.js');
  for (const path of [
    './optimizer/combined-set-core-search.js',
    './optimizer/dofus-package-frontier.js',
    './optimizer/dofus-package-refiner-contextual.js',
    './optimizer/dofus-package-refiner.js',
    './js/structural-exos.js',
    './js/synthetic-characteristics.js',
    './js/synthetic-characteristics-two-element-fast.js',
    './js/synthetic-characteristics-two-element-linear.js'
  ]) {
    assert.match(source, new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});
