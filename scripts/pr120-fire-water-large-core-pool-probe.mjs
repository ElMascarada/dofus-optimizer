import { readFileSync } from 'node:fs';

import { validateDofusSnapshot } from '../js/data-loader.js';
import { buildEquipmentCandidatePools } from '../optimizer/equipment-candidate-policy.js';
import { boundedCorePools } from '../optimizer/combined-set-core-search.js';

const raw = JSON.parse(readFileSync(new URL('../data/normalized/dofus-data.json', import.meta.url), 'utf8'));
const dataset = validateDofusSnapshot(raw);
const constraints = { ap: 12, mp: 6 };
const fmPolicy = { enabled: true, fmEnabled: true, exoAp: 1, exoMp: 1 };
const syntheticOffense = { elements: ['fire', 'water'], profiles: ['large'], critMode: 'auto' };

const prefilter = buildEquipmentCandidatePools({
  items: dataset.items,
  sets: dataset.sets,
  constraints,
  fmPolicy,
  syntheticOffense,
  searchProfile: 'BALANCED'
});

const targetNames = new Set(['Boulon de Mekamouth', 'Écrou de Mekamouth', 'Bêche de Mekamouth']);
const target = (prefilter.policy.setCoreCatalog?.cores || []).find((core) =>
  Number(core?.pieceCount) === 3
  && String(core?.setName || '') === 'Panoplie de Mekamouth'
  && (core?.items || []).length === 3
  && (core?.items || []).every((item) => targetNames.has(String(item?.name || '')))
);

if (!target) throw new Error('Mekamouth 3-piece owner core not found in canonical set-core catalog');

const pools = boundedCorePools(prefilter.policy, ['fire', 'water']);
const core3 = pools.get(3) || [];
const retained = core3.some((core) => String(core.id) === String(target.id));

console.log(`FW_LARGE_CORE3_POOL_SIZE=${core3.length}`);
console.log(`FW_LARGE_MEKAMOUTH_CORE_ID=${target.id}`);
console.log(`FW_LARGE_MEKAMOUTH_CORE_RETAINED=${retained ? 'YES' : 'NO'}`);

if (!retained) throw new Error('Mekamouth 3-piece owner core is still lost at boundedCorePools');
