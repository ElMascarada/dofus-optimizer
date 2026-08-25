import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');

test('PA and PM constraints are editable minimums', () => {
  assert.match(index, /id="min-ap"[^>]*min="6"[^>]*value="12"/);
  assert.match(index, /id="min-mp"[^>]*min="0"[^>]*value="6"/);
  assert.doesNotMatch(index, /id="min-ap"[^>]*readonly/);
  assert.doesNotMatch(index, /id="min-mp"[^>]*readonly/);
  assert.match(index, /tu peux demander 11\/5/);
});
