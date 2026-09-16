import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  curatedLowLevelEquipmentIds,
  isCuratedLowLevelEquipment
} from '../js/curated-equipment-inclusions.js';
import { isPlayerEquipmentScope, selectSnapshotItems } from '../js/data-certification.js';

function certifiedItem(ankamaId, level, extra = {}) {
  return {
    id: `item-${ankamaId}`,
    ankamaId,
    name: `Item ${ankamaId}`,
    level,
    slot: 'cape',
    setId: null,
    certification: {
      certified: true,
      slotKnown: true,
      conditionsCertified: true,
      temporalEffectsPending: false
    },
    ...extra
  };
}

test("Cape d'Ogivol is the only curated low-level equipment exception", () => {
  assert.deepEqual(curatedLowLevelEquipmentIds(), [13131]);
  assert.equal(isCuratedLowLevelEquipment({ ankamaId: 13131, level: 186, slot: 'cape' }), true);
  assert.equal(isCuratedLowLevelEquipment({ id: 'item-13131', level: 186, slot: 'cape' }), true);
  assert.equal(isCuratedLowLevelEquipment({ ankamaId: 99999, level: 186, slot: 'cape' }), false);
});

test('Cape d’Ogivol survives player scope and snapshot selection while another level-186 cape stays excluded', () => {
  const ogivol = certifiedItem(13131, 186, { name: "Cape d'Ogivol" });
  const ordinary = certifiedItem(99999, 186);
  assert.equal(isPlayerEquipmentScope(ogivol), true);
  assert.equal(isPlayerEquipmentScope(ordinary), false);
  assert.deepEqual(selectSnapshotItems([ogivol, ordinary], []).map((item) => item.id), ['item-13131']);
});

test('normalization keeps the global 190 threshold and adds curated exceptions explicitly', async () => {
  const normalizer = await readFile(new URL('../js/dofusdude-normalizer.js', import.meta.url), 'utf8');
  const certification = await readFile(new URL('../js/data-certification.js', import.meta.url), 'utf8');
  const script = await readFile(new URL('../scripts/normalize-dofusdude.mjs', import.meta.url), 'utf8');
  assert.match(normalizer, /Number\(item\.level\) >= 190/);
  assert.match(certification, /Number\(item\?\.level\) >= 190 \|\| isCuratedLowLevelEquipment\(item\)/);
  assert.match(script, /shouldIncludeEquipment\(item\) \|\| isCuratedLowLevelEquipment\(item\)/);
});
