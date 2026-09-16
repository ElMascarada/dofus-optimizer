import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  curatedLowLevelEquipmentIds,
  isCuratedLowLevelEquipment
} from '../js/curated-equipment-inclusions.js';

test("Cape d'Ogivol is the only curated low-level equipment exception", () => {
  assert.deepEqual(curatedLowLevelEquipmentIds(), [13131]);
  assert.equal(isCuratedLowLevelEquipment({ ankamaId: 13131, level: 186, slot: 'cape' }), true);
  assert.equal(isCuratedLowLevelEquipment({ id: 'item-13131', level: 186, slot: 'cape' }), true);
  assert.equal(isCuratedLowLevelEquipment({ ankamaId: 99999, level: 186, slot: 'cape' }), false);
});

test('normalization keeps the global 190 threshold and adds curated exceptions explicitly', async () => {
  const normalizer = await readFile(new URL('../js/dofusdude-normalizer.js', import.meta.url), 'utf8');
  const script = await readFile(new URL('../scripts/normalize-dofusdude.mjs', import.meta.url), 'utf8');
  assert.match(normalizer, /Number\(item\.level\) >= 190/);
  assert.match(script, /shouldIncludeEquipment\(item\) \|\| isCuratedLowLevelEquipment\(item\)/);
});
