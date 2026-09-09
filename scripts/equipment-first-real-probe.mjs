import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { validateDofusSnapshot } from '../js/data-loader.js';
import { searchEquipmentArchitecturesV2 } from '../js/equipment-search-v2.js';
import {
  completeSlotStructureIsValid,
  itemConditionsAreValid,
  permanentStatCapViolations
} from '../js/build-legality.js';
import { evaluateCompleteEquipmentBuild } from '../js/complete-equipment-build-evaluator.js';
import { constraintDeficits } from '../js/stats.js';

const WITNESS_IDS = Object.freeze([
  'item-22191',
  'item-14162',
  'item-15696',
  'item-26011',
  'item-14169',
  'item-22189',
  'item-13641',
  'item-22192',
  'item-13642',
  'item-13465',
  'item-22001',
  'item-13762',
  'item-13828',
  'item-694',
  'item-7754',
  'item-8698'
]);

const raw = JSON.parse(readFileSync(new URL('../data/normalized/dofus-data.json', import.meta.url), 'utf8'));
const dataset = validateDofusSnapshot(raw);
const syntheticOffense = { elements: ['earth'], profiles: ['large'] };
const constraints = { ap: 12, mp: 6 };
const fmPolicy = { exoAp: 0, exoMp: 0 };
const topN = 3;

const byId = new Map(dataset.items.map((item) => [String(item.id), item]));
const witnessItems = WITNESS_IDS.map((id) => byId.get(id)).filter(Boolean);
if (witnessItems.length !== WITNESS_IDS.length) {
  const missing = WITNESS_IDS.filter((id) => !byId.has(id));
  throw new Error(`Authoritative witness dataset drift: resolved ${witnessItems.length}/${WITNESS_IDS.length}; missing=${missing.join('|')}`);
}

const direct = evaluateCompleteEquipmentBuild({
  items: witnessItems,
  sets: dataset.sets,
  constraints,
  fmPolicy,
  syntheticOffense
});
const directValid = Boolean(direct.result);
console.log(`TRACE_DIRECT_WITNESS_VALID=${directValid ? 'YES' : 'NO'}`);
console.log(`TRACE_DIRECT_WITNESS_AP=${direct.result?.stats?.ap ?? 'NA'}`);
console.log(`TRACE_DIRECT_WITNESS_MP=${direct.result?.stats?.mp ?? 'NA'}`);
console.log(`TRACE_DIRECT_WITNESS_MIN=${direct.result?.syntheticOffense?.minimumScore ?? 'NA'}`);
console.log(`TRACE_DIRECT_WITNESS_MEAN=${direct.result?.syntheticOffense?.meanScore ?? 'NA'}`);
console.log(`TRACE_DIRECT_WITNESS_IDENTITY=${direct.result?.items?.map((item) => String(item.id)).sort().join('|') || 'NA'}`);
if (!directValid) throw new Error(`Authoritative witness failed direct evaluator: ${direct.reason || 'unknown'}`);

const forced = searchEquipmentArchitecturesV2({
  items: dataset.items,
  sets: dataset.sets,
  constraints,
  fmPolicy,
  syntheticOffense,
  requiredItemIds: WITNESS_IDS,
  topN,
  searchProfile: 'BALANCED'
});
const forcedIdentity = forced.results[0]?.items?.map((item) => String(item.id)).sort().join('|') || 'NA';
const expectedIdentity = [...WITNESS_IDS].sort().join('|');
const forcedValid = forced.results.length > 0 && forcedIdentity === expectedIdentity;
console.log(`TRACE_FORCED_WITNESS_VALID=${forcedValid ? 'YES' : 'NO'}`);
console.log(`TRACE_FORCED_WITNESS_RESULT_COUNT=${forced.results.length}`);
console.log(`TRACE_FORCED_WITNESS_IDENTITY=${forcedIdentity}`);
console.log(`TRACE_FORCED_WITNESS_MIN=${forced.results[0]?.syntheticOffense?.minimumScore ?? 'NA'}`);
if (!forcedValid) {
  console.log('FIRST_LOSS_POINT=FORCED_PATH_INCONSISTENCY');
  console.log(`FIRST_LOSS_EVIDENCE=direct evaluator passed but requiredItemIds search returned ${forced.results.length} result(s); reason=${forced.diagnostics?.reason || 'none'}`);
}

const started = performance.now();
const output = searchEquipmentArchitecturesV2({
  items: dataset.items,
  sets: dataset.sets,
  constraints,
  fmPolicy,
  syntheticOffense,
  diagnosticWitnessItemIds: forcedValid ? WITNESS_IDS : [],
  topN,
  searchProfile: 'BALANCED'
});
const wallMs = performance.now() - started;

if (!output.results.length) {
  console.error('REAL_CATALOG_PROBE=FAIL');
  console.error(`REAL_PROBE_CONSTRAINTS=${JSON.stringify(constraints)}`);
  console.error(`REAL_PROBE_EXO_POLICY=${JSON.stringify(fmPolicy)}`);
  console.error(`REAL_PROBE_DIAGNOSTICS=${JSON.stringify(output.diagnostics)}`);
  process.exitCode = 1;
} else {
  for (const [index, result] of output.results.entries()) {
    const structureValid = completeSlotStructureIsValid(result.items);
    const conditionsValid = itemConditionsAreValid(result.items, result.stats, 200);
    const deficits = constraintDeficits(result.stats, constraints);
    const capViolations = permanentStatCapViolations(result.stats, { includeMp: true });
    if (!structureValid || !conditionsValid || Object.keys(deficits).length || capViolations.length) {
      throw new Error(`Returned rank ${index + 1} failed authoritative legality recheck.`);
    }
    console.log(`RANK_${index + 1}_ITEM_IDS=${result.items.map((item) => String(item.id)).sort().join('|')}`);
    console.log(`RANK_${index + 1}_ITEM_NAMES=${result.items.map((item) => item.name).sort().join(' | ')}`);
    console.log(`RANK_${index + 1}_AP=${result.stats.ap}`);
    console.log(`RANK_${index + 1}_MP=${result.stats.mp}`);
    console.log(`RANK_${index + 1}_EARTH=${result.stats.earth || 0}`);
    console.log(`RANK_${index + 1}_POWER=${result.stats.power || 0}`);
    console.log(`RANK_${index + 1}_CRIT=${result.stats.crit || 0}`);
    console.log(`RANK_${index + 1}_CRIT_DAMAGE=${result.stats.critDamage || 0}`);
    console.log(`RANK_${index + 1}_DAMAGE=${result.stats.damage || 0}`);
    console.log(`RANK_${index + 1}_DAMAGE_EARTH=${result.stats.damageEarth || 0}`);
    console.log(`RANK_${index + 1}_MIN=${result.syntheticOffense.minimumScore}`);
    console.log(`RANK_${index + 1}_MEAN=${result.syntheticOffense.meanScore}`);
  }
  console.log('REAL_CATALOG_PROBE=PASS');
  console.log(`REAL_PROBE_SYNTHETIC_REQUEST=${JSON.stringify(syntheticOffense)}`);
  console.log(`REAL_PROBE_CONSTRAINTS=${JSON.stringify(constraints)}`);
  console.log(`REAL_PROBE_EXO_POLICY=${JSON.stringify(fmPolicy)}`);
  console.log(`REAL_PROBE_WALL_MS=${Math.round(wallMs * 1000) / 1000}`);
  console.log(`REAL_PROBE_CANDIDATES=${output.diagnostics.candidateCount}`);
  console.log(`REAL_PROBE_COMPLETE_STATES=${output.diagnostics.completeStates}`);
  console.log(`REAL_PROBE_EVALUATED=${output.diagnostics.evaluated}`);
  console.log(`REAL_PROBE_VALID=${output.diagnostics.valid}`);
  console.log(`REAL_PROBE_HEURISTIC_TRIMMED=${output.diagnostics.heuristicTrimmed}`);
  console.log(`REAL_PROBE_SAFE_PRUNED=${output.diagnostics.safePruned}`);
  console.log(`REAL_PROBE_TOPN=${topN}`);
}
