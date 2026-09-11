import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

import { validateDofusSnapshot } from '../js/data-loader.js';
import { searchEquipmentRequest } from '../js/equipment-search-request.js';

const raw = JSON.parse(readFileSync(new URL('../data/normalized/dofus-data.json', import.meta.url), 'utf8'));
const dataset = validateDofusSnapshot(raw);
const common = {
  items: dataset.items,
  sets: dataset.sets,
  constraints: { ap: 12, mp: 6 },
  fmPolicy: { enabled: true, fmEnabled: true, exoAp: 1, exoMp: 1 },
  topN: 20,
  searchProfile: 'BALANCED'
};

const cases = [
  { name: 'TWO_ELEMENTS', elements: ['earth', 'fire'] },
  { name: 'THREE_ELEMENTS', elements: ['earth', 'fire', 'water'] },
  { name: 'MULTI', elements: ['multi'] }
];

function itemNames(result) {
  return (result?.items || []).map((item) => item?.name || item?.id).join(' | ');
}

for (const probe of cases) {
  const startedAt = performance.now();
  const output = searchEquipmentRequest({
    ...common,
    syntheticOffense: { elements: probe.elements, profiles: ['large'], critMode: 'auto' }
  });
  const elapsedMs = performance.now() - startedAt;
  const best = output.results?.[0] || null;
  const diagnostics = output.diagnostics || {};
  const requestedProbes = best?.syntheticOffense?.requestedProbes || [];
  const probeElements = requestedProbes.map((entry) => entry.element);

  console.log(`${probe.name}_REAL_PROBE_RESULTS=${output.results?.length || 0}`);
  console.log(`${probe.name}_REAL_PROBE_AP=${best?.stats?.ap ?? 'NA'}`);
  console.log(`${probe.name}_REAL_PROBE_MP=${best?.stats?.mp ?? 'NA'}`);
  console.log(`${probe.name}_REAL_PROBE_SEARCH_MODE=${diagnostics.requestSearchMode || 'NA'}`);
  console.log(`${probe.name}_REAL_PROBE_NATIVE_COMBINED=${diagnostics.nativeCombinedObjective === true ? 'YES' : 'NO'}`);
  console.log(`${probe.name}_REAL_PROBE_REQUESTED_PROBES=${probeElements.join(',') || 'NA'}`);
  console.log(`${probe.name}_REAL_PROBE_EARTH=${best?.stats?.earth ?? 'NA'}`);
  console.log(`${probe.name}_REAL_PROBE_FIRE=${best?.stats?.fire ?? 'NA'}`);
  console.log(`${probe.name}_REAL_PROBE_WATER=${best?.stats?.water ?? 'NA'}`);
  console.log(`${probe.name}_REAL_PROBE_AIR=${best?.stats?.air ?? 'NA'}`);
  console.log(`${probe.name}_REAL_PROBE_DO_EARTH=${best?.stats?.damageEarth ?? 'NA'}`);
  console.log(`${probe.name}_REAL_PROBE_DO_FIRE=${best?.stats?.damageFire ?? 'NA'}`);
  console.log(`${probe.name}_REAL_PROBE_DO_WATER=${best?.stats?.damageWater ?? 'NA'}`);
  console.log(`${probe.name}_REAL_PROBE_DO_AIR=${best?.stats?.damageAir ?? 'NA'}`);
  console.log(`${probe.name}_REAL_PROBE_ITEMS=${itemNames(best) || 'NA'}`);
  console.log(`${probe.name}_REAL_PROBE_MS=${elapsedMs.toFixed(1)}`);

  if (!best) throw new Error(`${probe.name} real catalog probe returned no legal build`);
  if (diagnostics.requestSearchMode !== 'multi-element-native' || diagnostics.nativeCombinedObjective !== true) {
    throw new Error(`${probe.name} did not use native combined-objective search`);
  }
  if (Number(best.stats?.ap) !== 12 || Number(best.stats?.mp) !== 6) {
    throw new Error(`${probe.name} real catalog probe expected 12/6, got ${best.stats?.ap}/${best.stats?.mp}`);
  }
  if (Number(best.fm?.exoAp) !== 1 || Number(best.fm?.exoMp) !== 1) {
    throw new Error(`${probe.name} real catalog probe did not retain the PA/PM exo pair`);
  }

  if (!probe.elements.includes('multi')) {
    const actual = new Set(probeElements);
    for (const element of probe.elements) {
      if (!actual.has(element)) throw new Error(`${probe.name} combined ranking omitted ${element}`);
    }
  }
}
