import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const GENERIC_FILES = [
  new URL('../js/turn-optimizer.js', import.meta.url),
  new URL('../js/spells.js', import.meta.url),
  new URL('../js/combat-state.js', import.meta.url),
  new URL('../js/combat/effects.js', import.meta.url),
  new URL('../js/combat/mechanics/registry.js', import.meta.url)
];

test('generic combat runtime contains no class or curated spell identity branches', async () => {
  const source = (await Promise.all(GENERIC_FILES.map((url) => readFile(url, 'utf8')))).join('\n');
  for (const forbidden of ['Huppermage', 'Iop', 'Accumulation', 'Précipitation', '13138', '13114', '13672']) {
    assert.equal(source.includes(forbidden), false, `generic combat runtime must not contain ${forbidden}`);
  }
});
