import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('V2 product shell points to the sole Equipment-First Optimizer', async () => {
  const html = await read('index.html');
  assert.match(html, /DOFUS · EQUIPMENT-FIRST/);
  assert.match(html, /js\/optimizer-app\.js/);
  assert.doesNotMatch(html, /optimizer-v2-app\.js|optimizer-class|optimizer-turn-mode/);
});

test('Workshop bridge does not require a class before Find better', async () => {
  const source = await read('js/workshop/workshop-app.js');
  assert.match(source, /const canOptimize = filledCount > 0;/);
  assert.doesNotMatch(source, /Boolean\(build\.classId && filledCount > 0\)/);
  assert.doesNotMatch(source, /!controller\.build\.classId \|\| filledCount === 0/);
});
