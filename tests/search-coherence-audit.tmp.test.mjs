import test from 'node:test';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { createOptimizerV2Request } from '../js/optimizer-v2-orchestrator.js';
import { evaluateCompleteBuild } from '../js/complete-build-evaluator.js';
import { refineCombatTurns } from '../js/combat-turn-refiner.js';

const dataset = JSON.parse(readFileSync(new URL('../data/normalized/dofus-data.json', import.meta.url), 'utf8'));
const spellData = JSON.parse(readFileSync(new URL('../data/normalized/spell-data.json', import.meta.url), 'utf8'));

let workerHandler = null;
let activeMessages = null;
globalThis.self = {
  addEventListener(type, handler) {
    if (type === 'message') workerHandler = handler;
  },
  postMessage(message) {
    activeMessages?.push({ elapsedMs: performance.now() - activeMessages.startedAt, message });
  }
};
await import(`../js/optimizer-worker.js?search-coherence-audit=${Date.now()}`);

function initiativeSpecialists() {
  return (dataset.items || [])
    .filter((item) => item?.slot === 'dofus' && Number(item?.stats?.initiative || 0) >= 500)
    .map((item) => ({ id: item.id, name: item.name, typeName: item.typeName, setId: item.setId, stats: item.stats, conditions: item.conditions, certified: item.certified }))
    .sort((a, b) => Number(b.stats.initiative || 0) - Number(a.stats.initiative || 0));
}

function runRealWorker(payload) {
  activeMessages = [];
  activeMessages.startedAt = performance.now();
  workerHandler({ data: { type: 'optimize', requestId: 1, payload } });
  const elapsedMs = performance.now() - activeMessages.startedAt;
  const resultMessage = activeMessages.findLast((entry) => entry.message?.type === 'result')?.message;
  const errorMessage = activeMessages.findLast((entry) => entry.message?.type === 'error')?.message;
  const progress = activeMessages.filter((entry) => entry.message?.type === 'progress').map((entry) => ({
    elapsedMs: Math.round(entry.elapsedMs * 100) / 100,
    label: entry.message.progress?.label || '',
    best: Number(entry.message.progress?.best || 0),
    nodes: Number(entry.message.progress?.nodes || 0),
    partialResults: entry.message.progress?.partialResults?.length || 0
  }));
  activeMessages = null;
  if (!resultMessage) throw new Error(errorMessage?.message || 'Worker audit: no result message');
  return { output: resultMessage.output, elapsedMs, progress };
}

function spellMatchesElement(spell, element = 'multi') {
  if (element === 'multi' || !element) return Array.isArray(spell?.hits) && spell.hits.length > 0;
  return (spell?.hits || []).some((hit) => hit?.element === element);
}

function combatSpellPool(classSpells = [], combatObjective = {}) {
  const element = combatObjective.element || 'multi';
  return (classSpells || []).filter((spell) => {
    const support = (Array.isArray(spell?.combatModifiers) && spell.combatModifiers.length > 0)
      || (Array.isArray(spell?.delayedCombatModifiers) && spell.delayedCombatModifiers.length > 0)
      || Boolean(spell?.selfCharge);
    return support || spellMatchesElement(spell, element);
  });
}

function combatGearSelections(classSpells = [], combatObjective = {}) {
  const element = combatObjective.element || 'multi';
  return (classSpells || [])
    .filter((spell) => spellMatchesElement(spell, element))
    .map((spell) => ({ spell: { ...spell }, enabled: true, weight: 1, casts: { 1: 1, 2: 0, 3: 0 } }));
}

function suspiciousInitiativeItems(build) {
  return (build?.items || []).filter((item) => Number(item?.stats?.initiative || 0) >= 500);
}

function summarizeBuild(build) {
  return {
    score: build?.score,
    perTurn: build?.perTurn,
    items: (build?.items || []).map((item) => ({ id: item.id, name: item.name, slot: item.slot, initiative: Number(item?.stats?.initiative || 0), stats: item.stats, conditions: item.conditions })),
    stats: build?.stats,
    activeSets: build?.activeSets,
    warnings: build?.warnings
  };
}

function independentlyRecomputeCombat(build, payload) {
  const spells = combatSpellPool(payload.classSpells || [], payload.combatObjective || {});
  const rerun = refineCombatTurns({
    results: [build],
    spells,
    combatObjective: payload.combatObjective,
    topN: 1,
    preservePrysmaradites: true,
    searchProfile: payload.searchProfile || 'BALANCED'
  });
  return rerun.results?.[0] || null;
}

function alternativeDofusComparisons(found, maxCandidates = 24) {
  const build = found.build;
  const payload = found.payload;
  const suspicious = suspiciousInitiativeItems(build).find((item) => item.slot === 'dofus');
  if (!suspicious) return [];
  const selections = combatGearSelections(combatSpellPool(payload.classSpells || [], payload.combatObjective || {}), payload.combatObjective);
  const baseIds = new Set((build.items || []).map((item) => String(item.id)));
  const alternatives = (dataset.items || [])
    .filter((item) => item.slot === 'dofus' && !baseIds.has(String(item.id)) && Number(item?.stats?.initiative || 0) < 500)
    .slice(0, maxCandidates);
  const comparisons = [];
  for (const alternative of alternatives) {
    const items = (build.items || []).map((item) => String(item.id) === String(suspicious.id) ? alternative : item);
    const evaluated = evaluateCompleteBuild({
      items,
      sets: payload.sets,
      selections,
      constraints: payload.constraints,
      fmPolicy: payload.fmPolicy,
      turnMode: payload.turnMode,
      scenario: payload.scenario
    });
    if (!evaluated.result) continue;
    const combat = refineCombatTurns({
      results: [evaluated.result],
      spells: combatSpellPool(payload.classSpells || [], payload.combatObjective || {}),
      combatObjective: payload.combatObjective,
      topN: 1,
      preservePrysmaradites: true,
      searchProfile: payload.searchProfile || 'BALANCED'
    }).results?.[0];
    if (!combat) continue;
    comparisons.push({
      replaced: { id: suspicious.id, name: suspicious.name, stats: suspicious.stats },
      alternative: { id: alternative.id, name: alternative.name, stats: alternative.stats, conditions: alternative.conditions },
      score: combat.score,
      deltaScore: Number(combat.score || 0) - Number(build.score || 0),
      stats: combat.stats
    });
  }
  return comparisons.sort((a, b) => Number(b.score || 0) - Number(a.score || 0)).slice(0, 8);
}

test('temporary search coherence audit diagnostics', () => {
  console.log('SEARCH_COHERENCE_AUDIT_SPECIALISTS_BEGIN');
  console.log(JSON.stringify(initiativeSpecialists(), null, 2));
  console.log('SEARCH_COHERENCE_AUDIT_SPECIALISTS_END');

  const elements = ['earth', 'fire', 'water', 'air'];
  const cases = [];
  let inspectedFinalResults = 0;
  let found = null;
  outer: for (const breed of (spellData.breeds || [])) {
    for (const element of elements) {
      const payload = createOptimizerV2Request({
        dataset,
        spellData,
        classId: String(breed.id),
        element,
        constraints: { ap: 12, mp: 6, initiative: 0 },
        turnMode: 't1',
        topN: 10
      });
      if (!payload.classSpells.some((spell) => (spell.hits || []).length > 0)) continue;
      const run = runRealWorker(payload);
      const finals = run.output?.results || [];
      inspectedFinalResults += finals.length;
      const suspicious = finals.find((build) => suspiciousInitiativeItems(build).length > 0);
      cases.push({ classId: String(breed.id), className: breed.name, element, finals: finals.length, elapsedMs: Math.round(run.elapsedMs * 100) / 100, best: finals[0]?.score || 0, suspicious: Boolean(suspicious) });
      if (suspicious) {
        found = { breed, element, payload, build: suspicious, run };
        break outer;
      }
      if (cases.length >= 16) break outer;
    }
  }

  const audit = {
    constraints: { ap: 12, mp: 6, initiative: 0, turnMode: 't1', objectiveMode: 'combat', metric: 'total-damage' },
    casesTested: cases.length,
    inspectedFinalResults,
    cases,
    reproduced: Boolean(found)
  };
  console.log('SEARCH_COHERENCE_FINAL_SWEEP_BEGIN');
  console.log(JSON.stringify(audit, null, 2));
  console.log('SEARCH_COHERENCE_FINAL_SWEEP_END');

  if (found) {
    const independent = independentlyRecomputeCombat(found.build, found.payload);
    const alternatives = alternativeDofusComparisons(found);
    console.log('SEARCH_COHERENCE_REPRO_BEGIN');
    console.log(JSON.stringify({
      classId: String(found.breed.id),
      className: found.breed.name,
      element: found.element,
      constraints: found.payload.constraints,
      workerElapsedMs: Math.round(found.run.elapsedMs * 100) / 100,
      provenance: { source: 'main optimizer Worker', searchMemory: false, seedWorker: false },
      finalBuild: summarizeBuild(found.build),
      suspiciousInitiativeItems: suspiciousInitiativeItems(found.build).map((item) => ({ id: item.id, name: item.name, slot: item.slot, stats: item.stats, conditions: item.conditions })),
      independentRecompute: independent ? { score: independent.score, perTurn: independent.perTurn, stats: independent.stats } : null,
      alternatives,
      workerDiagnostics: found.run.output?.diagnostics,
      progressTimeline: found.run.progress
    }, null, 2));
    console.log('SEARCH_COHERENCE_REPRO_END');
  }
});
