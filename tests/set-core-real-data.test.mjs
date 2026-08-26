import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { validateDofusSnapshot } from '../js/data-loader.js';
import { buildSetCoreCatalog } from '../optimizer/set-core-catalog.js';

test('real normalized set data generates a non-empty canonical SetCoreCatalog', async () => {
  const raw = JSON.parse(await readFile(new URL('../data/normalized/dofus-data.json', import.meta.url), 'utf8'));
  const snapshot = validateDofusSnapshot(raw);
  const catalog = buildSetCoreCatalog({ items: snapshot.items, sets: snapshot.sets });

  assert.ok(snapshot.sets.length > 0);
  assert.ok(catalog.diagnostics.setsWithCores > 0);
  assert.ok(catalog.diagnostics.generated > 0);
  assert.ok(catalog.diagnostics.retained > 0);
  assert.ok(catalog.cores.every((core) => core.pieceCount >= 2 && core.pieceCount <= 4));
  assert.ok(catalog.cores.every((core) => core.legality.valid));

  console.log('SET_CORE_REAL_DATA', JSON.stringify(catalog.diagnostics));
});
