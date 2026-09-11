import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');

test('PA et PM restent visibles, initiative passe par le menu des contraintes avancées', () => {
  assert.match(index, /id="optimizer-min-ap"[^>]*min="0"[^>]*value="12"/);
  assert.match(index, /id="optimizer-min-mp"[^>]*min="0"[^>]*value="6"/);
  assert.doesNotMatch(index, /id="optimizer-min-ap"[^>]*readonly/);
  assert.doesNotMatch(index, /id="optimizer-min-mp"[^>]*readonly/);
  assert.doesNotMatch(index, /id="optimizer-min-initiative"/);
  assert.match(index, /<option value="initiative">Initiative minimum<\/option>/);
  assert.match(index, /id="optimizer-constraint-value"[^>]*min="0"/);
});
