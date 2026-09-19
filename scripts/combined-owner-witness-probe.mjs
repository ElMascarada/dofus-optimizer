import { readFileSync } from 'node:fs';

import { validateDofusSnapshot } from '../js/data-loader.js';
import { BASE_CHARACTER, SLOT_RULES } from '../js/config.js';
import { addStats, emptyStats } from '../js/stats.js';
import { applySetBonuses } from '../js/sets.js';
import { specialSlotRulesAreValid } from '../js/build-legality.js';
import {
  compareCompleteEquipmentBuildResults,
  evaluateCompleteEquipmentBuild
} from '../js/complete-equipment-build-evaluator.js';
import { searchEquipmentRequest } from '../js/equipment-search-request.js';
import { buildEquipmentCandidatePools } from '../optimizer/equipment-candidate-policy.js';
import { filterOptimizerEligibleItems } from '../optimizer/item-eligibility.js';
import {
  boundedCorePools,
  combinedOffenseSearchScore,
  retainCombinedArchitectureStates,
  retainFinalArchitectureCandidates,
  searchCombinedSetCoreEquipment
} from '../optimizer/combined-set-core-search.js';

const raw = JSON.parse(readFileSync(new URL('../data/normalized/dofus-data.json', import.meta.url), 'utf8'));
const dataset = validateDofusSnapshot(raw);

const constraints = { ap: 12, mp: 5, range: 6 };
const fmPolicy = { enabled: true, fmEnabled: true, exoAp: 1, exoMp: 1 };
const syntheticOffense = { elements: ['earth', 'fire'], profiles: ['large'], critMode: 'crit' };
const searchProfile = 'BALANCED';
const topN = 20;

const witnessNames = [
  'Masque du Katcheur',
  'Noblesse de Jahash Jurgen',
  'Amulette Volkorne',
  'Anneau du Cycloïde',
  'Anneau du Katcheur',
  'Ceinture Volkorne',
  'Bottes du Cycloïde',
  'Arc Volkorne',
  'Bouclier du Cycloïde',
  'Kokulte',
  'Dofus Pourpre',
  'Dofus des Glaces',
  'Dolmanax',
  'Dofus Ocre',
  'Arcaniste',
  'Dofus Sylvestre'
];

const EQUIPMENT_RULES = SLOT_RULES.filter((rule) => !['companion', 'dofus'].includes(rule.id));
const EQUIPMENT_CAPS = new Map(EQUIPMENT_RULES.map((rule) => [rule.id, Number(rule.count || 0)]));
const CORE_PATTERNS = [
  [4, 3, 2], [4, 3], [4, 2, 2], [4, 2], [4],
  [3, 3, 3], [3, 3, 2], [3, 2, 2, 2], [3, 2, 2], [3, 3], [3, 2], [3],
  [2, 2, 2, 2], [2, 2, 2], [2, 2], [2]
];

function normalize(value = '') {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function exactItem(name) {
  const wanted = normalize(name);
  const matches = dataset.items.filter((item) => normalize(item?.name) === wanted);
  if (matches.length !== 1) throw new Error(`witness resolution failed: ${name} matches=${matches.length}`);
  return matches[0];
}

function itemKey(items = []) {
  return (items || []).map((item) => String(item?.id ?? '')).sort().join('|');
}

function itemStats(items = [], setsById = {}) {
  const stats = emptyStats();
  for (const item of items || []) addStats(stats, item?.stats || {});
  applySetBonuses(stats, items, setsById);
  return stats;
}

function stateScore(items, policy, setsById) {
  const stats = itemStats(items, setsById);
  const ranked = combinedOffenseSearchScore(policy, stats);
  return { stats, ...ranked };
}

function equipmentShapeValid(items = []) {
  const counts = new Map();
  for (const item of items) {
    const count = Number(counts.get(item?.slot) || 0) + 1;
    if (count > Number(EQUIPMENT_CAPS.get(item?.slot) || 0)) return false;
    counts.set(item?.slot, count);
  }
  return specialSlotRulesAreValid(items);
}

function coresCompatible(cores = []) {
  const setIds = new Set();
  const itemIds = new Set();
  const items = [];
  for (const core of cores) {
    const setId = String(core.setId);
    if (setIds.has(setId)) return false;
    setIds.add(setId);
    for (const item of core.items || []) {
      const id = String(item.id);
      if (itemIds.has(id)) return false;
      itemIds.add(id);
      items.push(item);
    }
  }
  return equipmentShapeValid(items);
}

const witnessItems = witnessNames.map(exactItem);
const witnessIds = new Set(witnessItems.map((item) => String(item.id)));
const witnessEquipment = witnessItems.filter((item) => !['companion', 'dofus'].includes(item.slot));
const witnessKey = itemKey(witnessItems);
const witnessEquipmentKey = itemKey(witnessEquipment);

console.log(`WITNESS_ITEMS=${JSON.stringify(witnessItems.map((item) => ({ id: item.id, name: item.name, slot: item.slot, setId: item.setId ?? null })))}`);

const witnessEval = evaluateCompleteEquipmentBuild({
  items: witnessItems,
  sets: dataset.sets,
  constraints,
  fmPolicy,
  syntheticOffense
});
if (!witnessEval.result) throw new Error(`witness rejected: ${witnessEval.reason}`);
console.log(`WITNESS_SCORE=${witnessEval.result.syntheticOffense?.minimumScore ?? 'NA'}`);
console.log(`WITNESS_AP=${witnessEval.result.stats?.ap ?? 'NA'}`);
console.log(`WITNESS_MP=${witnessEval.result.stats?.mp ?? 'NA'}`);
console.log(`WITNESS_RANGE=${witnessEval.result.stats?.range ?? 'NA'}`);
console.log(`WITNESS_INITIATIVE=${witnessEval.result.stats?.initiative ?? 'NA'}`);

const finalOutput = searchEquipmentRequest({
  items: dataset.items,
  sets: dataset.sets,
  constraints,
  fmPolicy,
  syntheticOffense,
  topN,
  searchProfile
});
const finalBest = finalOutput.results?.[0] || null;
if (!finalBest) throw new Error('optimizer returned no legal build');
console.log(`SEARCH_SCORE=${finalBest.syntheticOffense?.minimumScore ?? 'NA'}`);
console.log(`SEARCH_WITNESS_EXACT=${(finalOutput.results || []).some((result) => itemKey(result.items) === witnessKey) ? 'YES' : 'NO'}`);
console.log(`SEARCH_VS_WITNESS=${compareCompleteEquipmentBuildResults(witnessEval.result, finalBest) > 0 ? 'WITNESS_BETTER' : 'SEARCH_NOT_WORSE'}`);
console.log(`SEARCH_MODE=${finalOutput.diagnostics?.requestSearchMode || 'NA'}`);

const eligibleItems = filterOptimizerEligibleItems(dataset.items);
const prefilter = buildEquipmentCandidatePools({
  items: eligibleItems,
  sets: dataset.sets,
  constraints,
  fmPolicy,
  syntheticOffense,
  searchProfile
});

let poolMissing = false;
for (const item of witnessItems) {
  const pool = prefilter.pools?.[item.slot] || [];
  const position = pool.findIndex((entry) => String(entry.id) === String(item.id));
  const present = position >= 0;
  if (!present) poolMissing = true;
  console.log(`POOL_ITEM=${item.name}|id=${item.id}|slot=${item.slot}|present=${present ? 'YES' : 'NO'}|position=${present ? `${position + 1}/${pool.length}` : 'NA'}`);
}
if (poolMissing) {
  console.log('FIRST_LOSS_POINT=CANDIDATE_POOL');
  process.exit(0);
}

const corePools = boundedCorePools(prefilter.policy, ['earth', 'fire']);
const grouped = new Map();
for (const item of witnessEquipment) {
  if (!item.setId) continue;
  const key = String(item.setId);
  if (!grouped.has(key)) grouped.set(key, []);
  grouped.get(key).push(item);
}
const witnessSetGroups = [...grouped.entries()].filter(([, group]) => group.length >= 2);
const exactCores = [];
let coreMissing = false;
for (const [setId, group] of witnessSetGroups) {
  const pool = corePools.get(group.length) || [];
  const exact = pool.find((core) => String(core.setId) === setId && itemKey(core.items) === itemKey(group));
  console.log(`CORE_GROUP=set:${setId}|pieces=${group.length}|items=${group.map((item) => item.name).join(' + ')}|present=${exact ? 'YES' : 'NO'}|pool=${pool.length}`);
  if (!exact) coreMissing = true;
  else exactCores.push(exact);
}
if (coreMissing) {
  console.log('FIRST_LOSS_POINT=BOUNDED_CORE_POOL');
  process.exit(0);
}

const setsById = Object.fromEntries(dataset.sets.map((set) => [set.id, set]));
const context = {
  axes: ['earth', 'fire'],
  policy: prefilter.policy,
  setsById,
  fmPolicy,
  constraints,
  specialistKeys: ['earth', 'damageEarth', 'fire', 'damageFire', 'power', 'damage', 'spellDamagePct', 'crit', 'critDamage', 'ap', 'mp', 'range']
};
const expectedCoreIds = new Set(exactCores.map((core) => String(core.id)));
const expectedCoreItemKey = itemKey(exactCores.flatMap((core) => core.items));
const allArchitectures = [];
let exactArchitectureReached = false;

for (const pattern of CORE_PATTERNS) {
  let states = [{ cores: [], items: [], stats: {}, score: 0, meanScore: 0, completionScore: 0, pattern: pattern.join('+') }];
  let patternCouldMatch = pattern.length === exactCores.length
    && [...pattern].sort((a, b) => a - b).join(',') === exactCores.map((core) => Number(core.pieceCount)).sort((a, b) => a - b).join(',');
  for (let step = 0; step < pattern.length; step++) {
    const pieceCount = pattern[step];
    const expanded = [];
    for (const state of states) {
      for (const core of corePools.get(pieceCount) || []) {
        const cores = [...state.cores, core];
        if (!coresCompatible(cores)) continue;
        const items = cores.flatMap((entry) => entry.items);
        const ranked = stateScore(items, context.policy, context.setsById);
        expanded.push({ cores, items, stats: ranked.stats, score: ranked.score, meanScore: ranked.meanScore,
          completionScore: ranked.completionScore, constraintSignal: ranked.constraintSignal, pattern: state.pattern });
      }
    }
    const witnessBefore = expanded.some((state) => state.cores.every((core) => expectedCoreIds.has(String(core.id))));
    states = retainCombinedArchitectureStates(expanded, 120, context);
    const witnessAfter = states.some((state) => state.cores.every((core) => expectedCoreIds.has(String(core.id))));
    if (patternCouldMatch) {
      console.log(`ARCH_STEP=pattern:${pattern.join('+')}|step=${step + 1}|pieceCount=${pieceCount}|expanded=${expanded.length}|retained=${states.length}|witnessBefore=${witnessBefore ? 'YES' : 'NO'}|witnessAfter=${witnessAfter ? 'YES' : 'NO'}`);
      if (witnessBefore && !witnessAfter) {
        console.log(`FIRST_LOSS_POINT=ARCHITECTURE_RETENTION_STEP_${step + 1}`);
        process.exit(0);
      }
    }
    if (!states.length) break;
  }
  allArchitectures.push(...states);
  if (states.some((state) => itemKey(state.items) === expectedCoreItemKey)) exactArchitectureReached = true;
}

console.log(`ARCH_EXACT_BEFORE_FINAL=${exactArchitectureReached ? 'YES' : 'NO'}`);
if (!exactArchitectureReached) {
  console.log('FIRST_LOSS_POINT=ARCHITECTURE_EXPANSION');
  process.exit(0);
}

const finalArchitectures = retainFinalArchitectureCandidates(allArchitectures, 180, context);
const exactAfterFinal = finalArchitectures.some((state) => itemKey(state.items) === expectedCoreItemKey);
console.log(`ARCH_EXACT_AFTER_FINAL=${exactAfterFinal ? 'YES' : 'NO'}|retained=${finalArchitectures.length}`);
if (!exactAfterFinal) {
  console.log('FIRST_LOSS_POINT=FINAL_ARCHITECTURE_RETENTION');
  process.exit(0);
}

const direct = searchCombinedSetCoreEquipment({
  items: dataset.items,
  sets: dataset.sets,
  constraints,
  fmPolicy,
  syntheticOffense,
  topN: 160,
  searchProfile
});
console.log(`DIRECT_RESULTS=${direct.results?.length || 0}`);
console.log(`DIRECT_WITNESS_EXACT=${(direct.results || []).some((result) => itemKey(result.items) === witnessKey) ? 'YES' : 'NO'}`);
console.log(`DIRECT_DIAGNOSTICS=${JSON.stringify(direct.diagnostics || null)}`);
console.log('FIRST_LOSS_POINT=AFTER_FINAL_ARCHITECTURE_NOT_YET_LOCALIZED');
