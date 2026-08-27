import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');

test('PA, PM et initiative sont des minimums éditables dans le parcours V2', () => {
  assert.match(index, /id="optimizer-min-ap"[^>]*min="0"[^>]*value="12"/);
  assert.match(index, /id="optimizer-min-mp"[^>]*min="0"[^>]*value="6"/);
  assert.match(index, /id="optimizer-min-initiative"[^>]*min="0"[^>]*value="0"/);
  assert.doesNotMatch(index, /id="optimizer-min-ap"[^>]*readonly/);
  assert.doesNotMatch(index, /id="optimizer-min-mp"[^>]*readonly/);
  assert.doesNotMatch(index, /id="optimizer-min-initiative"[^>]*readonly/);
});
