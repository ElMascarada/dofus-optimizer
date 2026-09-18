import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { validateDofusSnapshot } from '../js/data-loader.js';
import { searchEquipmentRequest } from '../js/equipment-search-request.js';

const raw = JSON.parse(readFileSync(new URL('../data/normalized/dofus-data.json', import.meta.url), 'utf8'));
const dataset = validateDofusSnapshot(raw);

const request = {
  items: dataset.items,
  sets: dataset.sets,
  constraints: {
    ap: 12,
    mp: 5,
    resEarth: 40,
    resFire: 40,
    resWater: 40,
    resAir: 40
  },
  fmPolicy: { enabled: true, fmEnabled: true, exoAp: 1, exoMp: 1 },
  syntheticOffense: {
    elements: ['earth'],
    profiles: ['large'],
    critMode: 'auto'
  },
  topN: 5
};

test('diagnostic owner witness: mono earth large auto 12/5 with 40 all-element resists', () => {
  const balanced = searchEquipmentRequest({ ...request, searchProfile: 'BALANCED' });
  console.log('RES40_BALANCED_RESULTS=' + (balanced.results?.length || 0));
  console.log('RES40_BALANCED_DIAGNOSTICS=' + JSON.stringify(balanced.diagnostics || null));

  const precise = searchEquipmentRequest({ ...request, searchProfile: 'PRECISE' });
  console.log('RES40_PRECISE_RESULTS=' + (precise.results?.length || 0));
  console.log('RES40_PRECISE_DIAGNOSTICS=' + JSON.stringify(precise.diagnostics || null));

  const final = searchEquipmentRequest({ ...request, searchProfile: 'FINAL' });
  console.log('RES40_FINAL_RESULTS=' + (final.results?.length || 0));
  console.log('RES40_FINAL_DIAGNOSTICS=' + JSON.stringify(final.diagnostics || null));

  const witness = final.results?.[0] || precise.results?.[0] || null;
  if (witness) {
    console.log('RES40_WITNESS_SCORE=' + witness.syntheticOffense?.minimumScore);
    console.log('RES40_WITNESS_STATS=' + JSON.stringify({
      ap: witness.stats?.ap,
      mp: witness.stats?.mp,
      resEarth: witness.stats?.resEarth,
      resFire: witness.stats?.resFire,
      resWater: witness.stats?.resWater,
      resAir: witness.stats?.resAir
    }));
    console.log('RES40_WITNESS_ITEMS=' + witness.items.map((item) => item.name).join(' | '));
  }

  assert.ok(
    balanced.results?.length || precise.results?.length || final.results?.length,
    'no legal build found even with wider search profiles'
  );
});
