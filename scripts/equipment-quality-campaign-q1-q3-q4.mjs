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
  topN: 5,
  searchProfile: 'BALANCED'
};

const cases = [
  {
    id: 'Q1',
    label: 'MONO_EARTH_SMALL_AUTO',
    syntheticOffense: { elements: ['earth'], profiles: ['small'], critMode: 'auto' }
  },
  {
    id: 'Q3',
    label: 'MONO_WATER_MEDIUM_NO_CRIT',
    syntheticOffense: { elements: ['water'], profiles: ['medium'], critMode: 'no_crit' }
  },
  {
    id: 'Q4',
    label: 'FIRE_WATER_SMALL_AUTO',
    syntheticOffense: { elements: ['fire', 'water'], profiles: ['small'], critMode: 'auto' },
    historicalBaseline: 3895.335
  }
];

function itemNames(result, slot = null) {
  return (result?.items || [])
    .filter((item) => !slot || item?.slot === slot)
    .map((item) => item?.name || String(item?.id ?? 'unknown'));
}

function compactIdentity(result) {
  if (result?.buildIdentity) return result.buildIdentity;
  return (result?.items || [])
    .map((item) => String(item?.id ?? item?.name ?? ''))
    .filter(Boolean)
    .sort()
    .join('|');
}

function offenseAxes(result) {
  return (result?.syntheticOffense?.requestedProbes || []).map((probe) => ({
    element: probe.element,
    profile: probe.profile,
    critMode: probe.critMode,
    effectiveCritChancePct: probe.effectiveCritChancePct,
    score: probe.totalApBudgetScore
  }));
}

function fmSummary(result) {
  const fm = result?.fm || {};
  return {
    enabled: Boolean(fm.enabled),
    critItems: Number(fm.critItems || 0),
    spellPctItems: Number(fm.spellPctItems || 0),
    assignments: (fm.assignments || []).map((entry) => ({
      type: entry?.type || null,
      itemId: entry?.itemId ?? null
    }))
  };
}

function topSummary(result, index) {
  return {
    rank: index + 1,
    identity: compactIdentity(result),
    minimumScore: result?.syntheticOffense?.minimumScore ?? null,
    meanScore: result?.syntheticOffense?.meanScore ?? null,
    ap: result?.stats?.ap ?? null,
    mp: result?.stats?.mp ?? null,
    crit: result?.stats?.crit ?? null,
    critDamage: result?.stats?.critDamage ?? null,
    companion: itemNames(result, 'companion'),
    shield: itemNames(result, 'shield'),
    dofus: itemNames(result, 'dofus'),
    items: itemNames(result)
  };
}

function semanticStats(result, syntheticOffense) {
  const stats = result?.stats || {};
  const elements = syntheticOffense.elements || [];
  const keys = new Set(['power', 'damage', 'crit', 'critDamage', 'spellDamagePct']);
  for (const element of elements) {
    if (element === 'multi') continue;
    keys.add(element);
    keys.add(`damage${element[0].toUpperCase()}${element.slice(1)}`);
  }
  return Object.fromEntries([...keys].map((key) => [key, Number(stats[key] || 0)]));
}

const hardFailures = [];

for (const probe of cases) {
  const startedAt = performance.now();
  const output = searchEquipmentRequest({
    ...common,
    syntheticOffense: probe.syntheticOffense
  });
  const elapsedMs = performance.now() - startedAt;
  const results = output.results || [];
  const best = results[0] || null;
  const uniqueIdentities = new Set(results.map(compactIdentity));

  console.log(`${probe.id}_LABEL=${probe.label}`);
  console.log(`${probe.id}_RESULTS=${results.length}`);
  console.log(`${probe.id}_UNIQUE_TOP5=${uniqueIdentities.size}`);
  console.log(`${probe.id}_ROUTE=${output.diagnostics?.requestSearchMode || 'NA'}`);
  console.log(`${probe.id}_MS=${elapsedMs.toFixed(1)}`);
  console.log(`${probe.id}_PERFORMANCE=${JSON.stringify(output.diagnostics?.performance || null)}`);

  if (!best) {
    console.log(`${probe.id}_CLASSIFICATION=FEASIBILITY_LOSS`);
    hardFailures.push(`${probe.id}: search returned zero results`);
    console.log(`${probe.id}_END=1`);
    continue;
  }

  console.log(`${probe.id}_BEST_MIN=${best.syntheticOffense?.minimumScore ?? 'NA'}`);
  console.log(`${probe.id}_BEST_MEAN=${best.syntheticOffense?.meanScore ?? 'NA'}`);
  console.log(`${probe.id}_BEST_AP=${best.stats?.ap ?? 'NA'}`);
  console.log(`${probe.id}_BEST_MP=${best.stats?.mp ?? 'NA'}`);
  console.log(`${probe.id}_BEST_CRIT=${best.stats?.crit ?? 'NA'}`);
  console.log(`${probe.id}_BEST_DO_CRIT=${best.stats?.critDamage ?? 'NA'}`);
  console.log(`${probe.id}_BEST_STATS=${JSON.stringify(semanticStats(best, probe.syntheticOffense))}`);
  console.log(`${probe.id}_BEST_AXES=${JSON.stringify(offenseAxes(best))}`);
  console.log(`${probe.id}_BEST_COMPANION=${JSON.stringify(itemNames(best, 'companion'))}`);
  console.log(`${probe.id}_BEST_SHIELD=${JSON.stringify(itemNames(best, 'shield'))}`);
  console.log(`${probe.id}_BEST_DOFUS=${JSON.stringify(itemNames(best, 'dofus'))}`);
  console.log(`${probe.id}_BEST_ITEMS=${JSON.stringify(itemNames(best))}`);
  console.log(`${probe.id}_BEST_FM=${JSON.stringify(fmSummary(best))}`);
  console.log(`${probe.id}_TOP5=${JSON.stringify(results.map(topSummary))}`);

  if (Number(best.stats?.ap || 0) < 12 || Number(best.stats?.mp || 0) < 6) {
    console.log(`${probe.id}_CLASSIFICATION=SEMANTIC_MISMATCH`);
    hardFailures.push(`${probe.id}: best result violates 12/6 hard minima`);
  } else if (probe.id === 'Q3') {
    const turquoise = itemNames(best, 'dofus').some((name) => /^Dofus Turquoise$/i.test(name));
    const critFm = Number(best?.fm?.critItems || 0);
    if (turquoise || critFm > 0) {
      console.log(`${probe.id}_CLASSIFICATION=SEMANTIC_MISMATCH`);
      hardFailures.push(`${probe.id}: no-crit result still spends objective resources on Crit/Do Crit`);
    } else {
      console.log(`${probe.id}_CLASSIFICATION=PASS`);
    }
  } else if (probe.id === 'Q4') {
    const score = Number(best.syntheticOffense?.minimumScore || 0);
    const delta = score - probe.historicalBaseline;
    console.log(`${probe.id}_HISTORICAL_BASELINE=${probe.historicalBaseline}`);
    console.log(`${probe.id}_BASELINE_DELTA=${delta}`);
    console.log(`${probe.id}_BASELINE_STATUS=${delta >= -1e-9 ? 'AT_OR_ABOVE' : 'BELOW_INVESTIGATE'}`);
    console.log(`${probe.id}_CLASSIFICATION=${delta >= -1e-9 ? 'PASS' : 'QUALITY_LOSS_SUSPECT'}`);
  } else {
    console.log(`${probe.id}_CLASSIFICATION=PASS`);
  }

  console.log(`${probe.id}_END=1`);
}

console.log(`CAMPAIGN_HARD_FAILURES=${hardFailures.length}`);
if (hardFailures.length) {
  for (const failure of hardFailures) console.error(`CAMPAIGN_FAILURE=${failure}`);
  process.exitCode = 1;
}
