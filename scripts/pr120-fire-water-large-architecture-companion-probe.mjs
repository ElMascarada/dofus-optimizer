import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { BASE_CHARACTER, SLOT_RULES } from '../js/config.js';
import { validateDofusSnapshot } from '../js/data-loader.js';
import { addStats, effectiveStat, emptyStats } from '../js/stats.js';
import { applySetBonuses } from '../js/sets.js';
import { specialSlotRulesAreValid } from '../js/build-legality.js';
import { statsWithStructuralExos } from '../js/structural-exos.js';
import { evaluateCompleteEquipmentBuild } from '../js/complete-equipment-build-evaluator.js';
import { buildEquipmentCandidatePools } from '../optimizer/equipment-candidate-policy.js';
import { filterOptimizerEligibleItems } from '../optimizer/item-eligibility.js';
import {
  boundedCorePools,
  combinedOffenseSearchScore,
  retainCombinedArchitectureStates,
  retainFinalArchitectureCandidates
} from '../optimizer/combined-set-core-search.js';

const raw = JSON.parse(readFileSync(new URL('../data/normalized/dofus-data.json', import.meta.url), 'utf8'));
const dataset = validateDofusSnapshot(raw);
const constraints = { ap: 12, mp: 6 };
const fmPolicy = { enabled: true, fmEnabled: true, exoAp: 1, exoMp: 1 };
const syntheticOffense = { elements: ['fire', 'water'], profiles: ['large'], critMode: 'auto' };
const axes = ['fire', 'water'];
const specialistKeys = ['fire', 'damageFire', 'water', 'damageWater', 'power', 'damage', 'spellDamagePct', 'crit', 'critDamage', 'ap', 'mp', 'range'];
const equipmentRules = SLOT_RULES.filter((rule) => !['companion', 'dofus'].includes(rule.id));
const equipmentCaps = new Map(equipmentRules.map((rule) => [rule.id, Number(rule.count || 0)]));
const CORE_PATTERNS = [
  [4, 3, 2], [4, 3], [4, 2, 2], [4, 2], [4],
  [3, 3, 3], [3, 3, 2], [3, 2, 2, 2], [3, 2, 2], [3, 3], [3, 2], [3],
  [2, 2, 2, 2], [2, 2, 2], [2, 2], [2]
];

const normalize = (value = '') => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
function exactItem(name) {
  const wanted = normalize(name);
  const matches = dataset.items.filter((item) => normalize(item?.name) === wanted);
  assert.equal(matches.length, 1, `resolve ${name}`);
  return matches[0];
}
function itemKey(items = []) {
  return items.map((item) => String(item?.id ?? '')).sort().join('|');
}
function architectureKey(state) {
  return (state?.cores || []).map((core) => String(core?.id ?? '')).filter(Boolean).sort().join('|');
}
function itemStats(items = [], setsById = {}) {
  const stats = emptyStats();
  for (const item of items) addStats(stats, item?.stats || {});
  applySetBonuses(stats, items, setsById);
  return stats;
}
function contextualStats(items = [], setsById = {}) {
  const stats = emptyStats();
  addStats(stats, BASE_CHARACTER.baseStats || {});
  for (const item of items) addStats(stats, item?.stats || {});
  applySetBonuses(stats, items, setsById);
  return statsWithStructuralExos(stats, fmPolicy).stats;
}
function scoreState(items, policy, setsById) {
  const stats = itemStats(items, setsById);
  const ranked = combinedOffenseSearchScore(policy, stats);
  return {
    stats,
    score: ranked.score,
    meanScore: ranked.meanScore,
    completionScore: ranked.completionScore,
    constraintSignal: ranked.constraintSignal
  };
}
function comparePriority(a, b) {
  return Number(b?.score || 0) - Number(a?.score || 0)
    || Number(b?.meanScore || 0) - Number(a?.meanScore || 0)
    || itemKey(a?.items || []).localeCompare(itemKey(b?.items || []));
}
function equipmentShapeValid(items = []) {
  const counts = new Map();
  for (const item of items) {
    const count = Number(counts.get(item?.slot) || 0) + 1;
    if (count > Number(equipmentCaps.get(item?.slot) || 0)) return false;
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
function positiveConstraintKeys() {
  return Object.entries(constraints).filter(([, minimum]) => Number(minimum) > 0).map(([key]) => key);
}
function setSignature(items = []) {
  const counts = new Map();
  for (const item of items) if (item?.setId) counts.set(String(item.setId), Number(counts.get(String(item.setId)) || 0) + 1);
  return [...counts.entries()].filter(([, count]) => count >= 2).sort(([a], [b]) => a.localeCompare(b)).map(([id, count]) => `${id}:${count}`).join(',');
}
function resourceBucket(items, setsById) {
  const stats = contextualStats(items, setsById);
  return `${Math.min(12, effectiveStat(stats, 'ap'))}:${Math.min(6, effectiveStat(stats, 'mp'))}:${setSignature(items)}`;
}
function retainStates(states, limit, context) {
  const dedup = new Map();
  for (const state of states || []) {
    const key = itemKey(state.items);
    if (!key) continue;
    const previous = dedup.get(key);
    if (!previous || comparePriority(state, previous) < 0) dedup.set(key, state);
  }
  const ranked = [...dedup.values()].sort(comparePriority);
  if (ranked.length <= limit) return ranked;
  const output = [];
  const seen = new Set();
  const perBucket = new Map();
  const add = (state, enforceBucket = false) => {
    if (!state || output.length >= limit) return;
    const key = itemKey(state.items);
    if (seen.has(key)) return;
    const bucket = resourceBucket(state.items, context.setsById);
    const used = Number(perBucket.get(bucket) || 0);
    if (enforceBucket && used >= 4) return;
    seen.add(key);
    perBucket.set(bucket, used + 1);
    output.push(state);
  };
  for (const statKey of context.specialistKeys || []) {
    const specialists = [...ranked]
      .filter((state) => effectiveStat(state.stats || itemStats(state.items, context.setsById), statKey) > 0)
      .sort((a, b) => effectiveStat(b.stats || itemStats(b.items, context.setsById), statKey)
        - effectiveStat(a.stats || itemStats(a.items, context.setsById), statKey)
        || comparePriority(a, b))
      .slice(0, 3);
    for (const state of specialists) add(state);
  }
  for (const state of ranked) add(state, true);
  for (const state of ranked) add(state, false);
  return output;
}
function slotPool(slot, eligibleItems, prefilter, context) {
  const candidates = new Map();
  const add = (item) => { if (item?.slot === slot) candidates.set(String(item.id), item); };
  for (const item of prefilter.pools?.[slot] || []) add(item);
  const rows = eligibleItems.filter((item) => item?.slot === slot).map((item) => ({ item, profiled: context.policy.profileItem(item) }));
  const offenseRows = [...rows].sort((a, b) => Number(b.profiled.objectiveGain || 0) - Number(a.profiled.objectiveGain || 0)
    || Number(b.profiled.meanGain || 0) - Number(a.profiled.meanGain || 0)
    || String(a.item.id).localeCompare(String(b.item.id)));
  for (const row of offenseRows.slice(0, 18)) add(row.item);
  for (const key of [...new Set([...context.specialistKeys, ...positiveConstraintKeys()])]) {
    for (const row of [...rows]
      .filter((entry) => effectiveStat(entry.profiled.optimisticStats || {}, key) > 0)
      .sort((a, b) => effectiveStat(b.profiled.optimisticStats || {}, key) - effectiveStat(a.profiled.optimisticStats || {}, key)
        || Number(b.profiled.objectiveGain || 0) - Number(a.profiled.objectiveGain || 0)
        || Number(b.profiled.meanGain || 0) - Number(a.profiled.meanGain || 0))
      .slice(0, 4)) add(row.item);
  }
  const candidateRows = [...candidates.values()].map((item) => ({ item, profiled: context.policy.profileItem(item) }));
  const limit = slot === 'ring' ? 34 : 28;
  const selected = new Map();
  for (const key of [...new Set(['ap', 'mp', ...positiveConstraintKeys()])]) {
    for (const row of [...candidateRows]
      .filter((entry) => effectiveStat(entry.profiled.optimisticStats || {}, key) > 0)
      .sort((a, b) => effectiveStat(b.profiled.optimisticStats || {}, key) - effectiveStat(a.profiled.optimisticStats || {}, key)
        || Number(b.profiled.objectiveGain || 0) - Number(a.profiled.objectiveGain || 0)
        || Number(b.profiled.meanGain || 0) - Number(a.profiled.meanGain || 0))
      .slice(0, 2)) {
      if (selected.size >= limit) break;
      selected.set(String(row.item.id), row.item);
    }
  }
  for (const row of candidateRows.sort((a, b) => Number(b.profiled.objectiveGain || 0) - Number(a.profiled.objectiveGain || 0)
    || Number(b.profiled.meanGain || 0) - Number(a.profiled.meanGain || 0)
    || Number(b.profiled.rankScore || 0) - Number(a.profiled.rankScore || 0)
    || String(a.item.id).localeCompare(String(b.item.id)))) {
    if (selected.size >= limit) break;
    selected.set(String(row.item.id), row.item);
  }
  return [...selected.values()];
}
function firstMissingEquipmentSlot(items = []) {
  const counts = new Map();
  for (const item of items) counts.set(item?.slot, Number(counts.get(item?.slot) || 0) + 1);
  for (const rule of equipmentRules) if (Number(counts.get(rule.id) || 0) < Number(rule.count || 0)) return rule.id;
  return null;
}

const coreNames = [
  "Masque de l'Esprit Malsain", 'Cape Ovri', 'Talisman Songe', 'Boulon de Mekamouth',
  'Écrou de Mekamouth', 'Sangle Ouare', "Bottes de l'Esprit Malsain", 'Bêche de Mekamouth'
];
const coreItems = coreNames.map(exactItem);
const coreItemKey = itemKey(coreItems);
const carapace = exactItem('Carapace Onance');
const quatreFeuilles = exactItem('Quatre-feuilles');
const kokulte = exactItem('Kokulte');
const ownerDofus = ['Impétueux', 'Arcaniste', 'Dofus des Glaces', 'Dofus Ocre', 'Dofus Turquoise', 'Dofus Pourpre'].map(exactItem);

const eligibleItems = filterOptimizerEligibleItems(dataset.items);
const prefilter = buildEquipmentCandidatePools({ items: eligibleItems, sets: dataset.sets, constraints, fmPolicy, syntheticOffense, searchProfile: 'BALANCED' });
const setsById = Object.fromEntries(dataset.sets.map((set) => [set.id, set]));
const context = { axes, policy: prefilter.policy, setsById, fmPolicy, constraints, specialistKeys };
const corePools = boundedCorePools(prefilter.policy, axes);

const all = [];
for (const pattern of CORE_PATTERNS) {
  let states = [{ cores: [], items: [], stats: {}, score: 0, meanScore: 0, completionScore: 0, constraintSignal: 0, pattern: pattern.join('+') }];
  for (const pieceCount of pattern) {
    const expanded = [];
    for (const state of states) {
      for (const core of corePools.get(pieceCount) || []) {
        const cores = [...state.cores, core];
        if (!coresCompatible(cores)) continue;
        const items = cores.flatMap((entry) => entry.items);
        expanded.push({ cores, items, ...scoreState(items, prefilter.policy, setsById), pattern: state.pattern });
      }
    }
    states = retainCombinedArchitectureStates(expanded, 120, context);
    if (!states.length) break;
  }
  all.push(...states);
}
const architectures = retainFinalArchitectureCandidates(all, 180, context);
const ownerArchitecture = architectures.find((state) => itemKey(state.items) === coreItemKey);
assert.ok(ownerArchitecture, 'owner architecture must survive architecture retention');
const ownerArchitectureKey = architectureKey(ownerArchitecture);

const slotPools = Object.fromEntries(equipmentRules.map((rule) => [rule.id, slotPool(rule.id, eligibleItems, prefilter, context)]));
const expandedRound0 = [];
for (const state of architectures) {
  const slot = firstMissingEquipmentSlot(state.items);
  if (!slot) {
    expandedRound0.push(state);
    continue;
  }
  const used = new Set(state.items.map((item) => String(item.id)));
  for (const item of slotPools[slot] || []) {
    if (used.has(String(item.id))) continue;
    const items = [...state.items, item];
    if (!equipmentShapeValid(items)) continue;
    expandedRound0.push({ ...state, items, ...scoreState(items, prefilter.policy, setsById) });
  }
}
const rankedRound0 = [...expandedRound0].sort(comparePriority);
const bestByArchitecture = new Map();
for (const state of rankedRound0) {
  const key = architectureKey(state);
  if (key && !bestByArchitecture.has(key)) bestByArchitecture.set(key, state);
}
const winners = [...bestByArchitecture.values()].sort(comparePriority);
const ownerBest = bestByArchitecture.get(ownerArchitectureKey);
assert.ok(ownerBest, 'owner architecture must have a round-0 descendant');
const ownerBestShield = ownerBest.items.find((item) => item.slot === 'shield');
const ownerBestGlobalRank = rankedRound0.findIndex((state) => itemKey(state.items) === itemKey(ownerBest.items)) + 1;
const ownerBestWinnerRank = winners.findIndex((state) => architectureKey(state) === ownerArchitectureKey) + 1;
const retained260 = retainStates(expandedRound0, 260, context);
const ownerRetained = retained260.filter((state) => architectureKey(state) === ownerArchitectureKey);
console.log(`FW_LARGE_ARCH_CHILD_EXPANDED=${expandedRound0.length}`);
console.log(`FW_LARGE_ARCH_CHILD_DISTINCT_ARCHITECTURES=${bestByArchitecture.size}`);
console.log(`FW_LARGE_ARCH_CHILD_OWNER_BEST=${JSON.stringify({ shield: ownerBestShield?.name || null, score: ownerBest.score, globalRank: ownerBestGlobalRank, winnerRank: ownerBestWinnerRank })}`);
console.log(`FW_LARGE_ARCH_CHILD_OWNER_RETAINED_260=${ownerRetained.length ? 'YES' : 'NO'}`);
console.log(`FW_LARGE_ARCH_CHILD_OWNER_RETAINED_SHIELDS=${JSON.stringify(ownerRetained.map((state) => state.items.find((item) => item.slot === 'shield')?.name || null))}`);

const companionPool = slotPool('companion', eligibleItems, prefilter, context).slice(0, 20);
const kokultePoolIndex = companionPool.findIndex((item) => String(item.id) === String(kokulte.id));
console.log(`FW_LARGE_COMPANION_POOL_SIZE=${companionPool.length}`);
console.log(`FW_LARGE_KOKULTE_IN_POOL=${kokultePoolIndex >= 0 ? 'YES' : 'NO'}`);
console.log(`FW_LARGE_KOKULTE_POOL_RANK=${kokultePoolIndex >= 0 ? kokultePoolIndex + 1 : 'NA'}`);

function companionRankingFor(equipmentItems, label) {
  const rows = [];
  for (const companion of companionPool) {
    const items = [...equipmentItems, companion];
    if (!specialSlotRulesAreValid(items)) continue;
    rows.push({ companion, items, ...scoreState(items, prefilter.policy, setsById) });
  }
  rows.sort(comparePriority);
  const kokulteRank = rows.findIndex((row) => String(row.companion.id) === String(kokulte.id)) + 1;
  console.log(`FW_LARGE_${label}_KOKULTE_PARTIAL_RANK=${kokulteRank || 'NA'}`);
  console.log(`FW_LARGE_${label}_BEST_COMPANION=${JSON.stringify(rows[0] ? { name: rows[0].companion.name, score: rows[0].score } : null)}`);

  const finalRows = [];
  for (const row of rows) {
    const evaluation = evaluateCompleteEquipmentBuild({ items: [...equipmentItems, row.companion, ...ownerDofus], sets: dataset.sets, constraints, fmPolicy, syntheticOffense });
    if (evaluation.result) finalRows.push({ companion: row.companion, result: evaluation.result });
  }
  finalRows.sort((a, b) => Number(b.result.syntheticOffense?.minimumScore || 0) - Number(a.result.syntheticOffense?.minimumScore || 0)
    || Number(b.result.syntheticOffense?.meanScore || 0) - Number(a.result.syntheticOffense?.meanScore || 0)
    || String(a.companion.id).localeCompare(String(b.companion.id)));
  const kokulteFinalRank = finalRows.findIndex((row) => String(row.companion.id) === String(kokulte.id)) + 1;
  console.log(`FW_LARGE_${label}_KOKULTE_FINAL_RANK=${kokulteFinalRank || 'NA'}`);
  console.log(`FW_LARGE_${label}_BEST_COMPANION_FINAL=${JSON.stringify(finalRows[0] ? { name: finalRows[0].companion.name, minimumScore: finalRows[0].result.syntheticOffense?.minimumScore, meanScore: finalRows[0].result.syntheticOffense?.meanScore } : null)}`);
}

companionRankingFor([...coreItems, carapace], 'CARAPACE');
companionRankingFor([...coreItems, quatreFeuilles], 'QUATRE_FEUILLES');

const completeWinners = winners.filter((state) => !firstMissingEquipmentSlot(state.items));
const companionExpanded = [];
for (const state of completeWinners) {
  for (const companion of companionPool) {
    const items = [...state.items, companion];
    if (!specialSlotRulesAreValid(items)) continue;
    companionExpanded.push({ ...state, items, ...scoreState(items, prefilter.policy, setsById) });
  }
}
const retained55 = retainStates(companionExpanded, 55, context);
const ownerCarapaceKokulteKey = itemKey([...coreItems, carapace, kokulte]);
const ownerQuatreKokulteKey = itemKey([...coreItems, quatreFeuilles, kokulte]);
console.log(`FW_LARGE_COMPANION_FROM_ARCH_WINNERS=${JSON.stringify({ completeArchitectureWinners: completeWinners.length, expanded: companionExpanded.length, retained: retained55.length, carapaceKokulteBefore: companionExpanded.some((state) => itemKey(state.items) === ownerCarapaceKokulteKey), carapaceKokulteAfter: retained55.some((state) => itemKey(state.items) === ownerCarapaceKokulteKey), quatreKokulteBefore: companionExpanded.some((state) => itemKey(state.items) === ownerQuatreKokulteKey), quatreKokulteAfter: retained55.some((state) => itemKey(state.items) === ownerQuatreKokulteKey) })}`);
