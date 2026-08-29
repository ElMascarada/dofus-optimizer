import { readFileSync } from 'node:fs';

import { evaluateCompleteBuild } from '../js/complete-build-evaluator.js';
import { canonicalT1ContextIsUsable } from '../js/combat-evaluation-context.js';
import { createOptimizerV2Request } from '../js/optimizer-v2-orchestrator.js';
import { validateDofusSnapshot, validateSpellSnapshot } from '../js/data-loader.js';
import {
  createWorkshopBuildFromOptimizerResult,
  workshopBuildIsComplete,
  workshopCombatSignature
} from '../js/workshop/workshop-build.js';
import { evaluateWorkshopBuild } from '../js/workshop/workshop-evaluator.js';
import { analyzeWorkshopTurns } from '../js/workshop/workshop-turn-analysis.js';

const rawItems = JSON.parse(readFileSync(new URL('../data/normalized/dofus-data.json', import.meta.url), 'utf8'));
const rawSpells = JSON.parse(readFileSync(new URL('../data/normalized/spell-data.json', import.meta.url), 'utf8'));
const dataset = validateDofusSnapshot(rawItems);
const spellData = validateSpellSnapshot(rawSpells);
const iop = (spellData.breeds || []).find((breed) => breed?.name === 'Iop');

if (!iop) throw new Error('Iop absent des données canoniques.');

const request = createOptimizerV2Request({
  dataset,
  spellData,
  classId: String(iop.id),
  element: 'earth',
  constraints: {
    ap: 12,
    mp: 6,
    range: 0,
    vit: 0,
    initiative: 0,
    resEarth: 0,
    resFire: 0,
    resWater: 0,
    resAir: 0
  },
  turnMode: 't1',
  topN: 10
});

let workerHandler = null;
let messages = [];
globalThis.self = {
  addEventListener(type, handler) {
    if (type === 'message') workerHandler = handler;
  },
  postMessage(message) {
    messages.push(message);
  }
};
await import('../js/optimizer-worker.js');

if (!workerHandler) throw new Error('Optimizer Worker indisponible hors UI.');
workerHandler({ data: { type: 'optimize', requestId: 'product-smoke-v1', payload: request } });

const resultMessage = messages.findLast((message) => message?.type === 'result');
const errorMessage = messages.findLast((message) => message?.type === 'error');
const output = resultMessage?.output || { results: [], diagnostics: {} };
const results = output.results || [];
const best = results[0] || null;
const diagnostics = output.diagnostics || {};

const ignoredPassiveIds = [
  'deep-purple',
  'turquoise-blue',
  'vermilion-red',
  'yellow-ochre',
  'descent-to-abyss'
];
const gearSelections = (request.classSpells || [])
  .filter((spell) => (spell?.hits || []).some((hit) => hit?.element === 'earth'))
  .map((spell) => ({
    spell: { ...spell },
    enabled: true,
    weight: 1,
    casts: { 1: 1, 2: 0, 3: 0 }
  }));

let buildLegal = false;
if (best) {
  const legalEvaluation = evaluateCompleteBuild({
    items: best.items || [],
    sets: request.sets || [],
    selections: gearSelections,
    constraints: request.constraints,
    fmPolicy: { ...request.fmPolicy, structuralExos: false },
    turnMode: 't1',
    scenario: {
      ...(request.scenario || {}),
      requiredApByTurn: {},
      ignoredPassiveIds
    }
  });
  buildLegal = Boolean(legalEvaluation.result);
}

let workshop = null;
let workshopBuild = null;
let workshopConversion = 'UNKNOWN';
let workshopComplete = 'UNKNOWN';
let workshopEvaluation = 'UNKNOWN';
let workshopReason = 'NONE';
if (best) {
  try {
    workshopBuild = createWorkshopBuildFromOptimizerResult({
      result: best,
      classId: request.classId,
      fmPolicy: request.fmPolicy,
      combatObjective: request.combatObjective,
      scenario: request.scenario,
      spellIds: request.classSpells.map((spell) => String(spell.id)),
      searchProfile: request.searchProfile
    });
    workshopConversion = 'PASS';
    workshopComplete = workshopBuildIsComplete(workshopBuild) ? 'PASS' : 'FAIL';
  } catch (error) {
    workshopConversion = 'FAIL';
    workshopReason = error instanceof Error ? error.message : String(error);
  }

  if (workshopBuild) {
    try {
      workshop = evaluateWorkshopBuild({ build: workshopBuild, dataset, spellData });
      workshopEvaluation = workshop.valid ? 'PASS' : 'FAIL';
      if (!workshop.valid) workshopReason = workshop.reason ?? 'NONE';
    } catch (error) {
      workshopEvaluation = 'FAIL';
      workshopReason = error instanceof Error ? error.message : String(error);
    }
  }
}
const workshopStatus = !best
  ? 'UNKNOWN'
  : workshopConversion === 'PASS' && workshopComplete === 'PASS' && workshopEvaluation === 'PASS'
    ? 'PASS'
    : 'FAIL';

const finalStats = workshop?.stats || {};
const workshopTurns = workshopStatus === 'PASS' ? analyzeWorkshopTurns(workshop) : null;
const t1 = workshopTurns?.turns?.find((entry) => Number(entry?.turn) === 1) || null;
const t1Sequence = t1?.actions || [];
const t1Damage = Number(t1?.damage || 0);
const optimizerT1Damage = Number(best?.combatPlan?.perTurn?.[1] ?? best?.perTurn?.[1] ?? 0);
const optimizerTurnMode = String(best?.combatPlan?.objective?.turnMode || 'UNKNOWN');
const workshopTurnMode = String(workshopTurns?.plan?.objective?.turnMode || 'UNKNOWN');
const canonicalContext = workshopBuild?.canonicalCombatContext || null;
const canonicalT1ContextPass = canonicalT1ContextIsUsable(canonicalContext)
  && workshop?.combatEvaluationSource === 'optimizer-canonical-t1';
const sameBuild = Boolean(workshopBuild?.canonicalCombatSignature)
  && workshopBuild.canonicalCombatSignature === workshopCombatSignature(workshopBuild);
const sameScenario = JSON.stringify(canonicalContext?.scenario || null) === JSON.stringify(request.scenario || null);
const sameResolvedCombatContext = JSON.stringify(canonicalContext?.stats || null) === JSON.stringify(best?.stats || null)
  && JSON.stringify(canonicalContext?.effectiveStatsByTurn?.[1] || null) === JSON.stringify(best?.effectiveStatsByTurn?.[1] || null)
  && JSON.stringify(canonicalContext?.fm || null) === JSON.stringify(best?.fm || null)
  && canonicalContext?.initialCombatState === 'default-empty';
const t1Delta = t1Damage - optimizerT1Damage;
const canonicalTruth = canonicalT1ContextPass
  && optimizerTurnMode === 't1'
  && workshopTurnMode === 't1'
  && sameBuild
  && sameScenario
  && sameResolvedCombatContext
  && Number.isFinite(optimizerT1Damage)
  && Number.isFinite(t1Damage)
  && Math.abs(t1Delta) <= 1e-9;

const damageBySpell = new Map();
for (const entry of t1Sequence) {
  const damage = Number(entry?.expectedDamage || 0);
  if (damage <= 0) continue;
  const key = String(entry?.spellId ?? entry?.name ?? 'unknown');
  damageBySpell.set(key, (damageBySpell.get(key) || 0) + damage);
}
const spellBreakdown = [...damageBySpell.entries()].sort(([left], [right]) => left.localeCompare(right));

function number(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 'UNKNOWN';
  return Number.isInteger(parsed) ? String(parsed) : parsed.toFixed(2);
}

const t1PlanPass = t1Sequence.length > 0;
const spellBreakdownPass = spellBreakdown.length > 0;
const statsPresent = ['ap', 'mp', 'earth', 'power'].every((key) => Number.isFinite(Number(finalStats?.[key])));
const pass = !errorMessage
  && results.length > 0
  && buildLegal
  && workshopStatus === 'PASS'
  && statsPresent
  && t1PlanPass
  && t1Damage > 0
  && spellBreakdownPass
  && canonicalTruth;

console.log('PRODUCT_SMOKE');
console.log('scenario=Iop/Earth/T1/12AP/6MP/0Initiative');
console.log('');
console.log(`optimizerResults=${results.length}`);
console.log(`bestScore=${best ? number(best.score) : 'UNKNOWN'}`);
console.log('');
console.log(`buildLegal=${buildLegal ? 'PASS' : 'FAIL'}`);
console.log(`workshopLegal=${workshopStatus}`);
console.log(`workshopConversion=${workshopConversion}`);
console.log(`workshopComplete=${workshopComplete}`);
console.log(`workshopEvaluation=${workshopEvaluation}`);
console.log(`workshopReason=${workshopReason}`);
console.log('');
console.log(`ap=${number(finalStats?.ap)}`);
console.log(`mp=${number(finalStats?.mp)}`);
console.log(`earth=${number(finalStats?.earth)}`);
console.log(`power=${number(finalStats?.power)}`);
console.log('');
console.log(`t1Plan=${t1PlanPass ? 'PASS' : 'FAIL'}`);
console.log(`t1Damage=${number(t1Damage)}`);
console.log(`spellBreakdown=${spellBreakdownPass ? 'PASS' : 'FAIL'}${spellBreakdownPass ? ` ${spellBreakdown.map(([id, damage]) => `${id}:${number(damage)}`).join(',')}` : ''}`);
console.log('');
console.log(`canonicalT1Context=${canonicalT1ContextPass ? 'PASS' : 'FAIL'}`);
console.log(`optimizerTurnMode=${optimizerTurnMode === 't1' ? 'T1' : optimizerTurnMode}`);
console.log(`workshopTurnMode=${workshopTurnMode === 't1' ? 'T1' : workshopTurnMode}`);
console.log(`sameBuild=${sameBuild ? 'YES' : 'NO'}`);
console.log(`sameScenario=${sameScenario ? 'YES' : 'NO'}`);
console.log(`sameResolvedCombatContext=${sameResolvedCombatContext ? 'YES' : 'NO'}`);
console.log(`optimizerT1Damage=${number(optimizerT1Damage)}`);
console.log(`workshopT1Damage=${number(t1Damage)}`);
console.log(`delta=${number(t1Delta)}`);
console.log(`canonicalTruth=${canonicalTruth ? 'PASS' : 'FAIL'}`);
console.log('');
console.log(`primaryValid=${number(diagnostics.valid || 0)}`);
console.log(`fallbackValid=${number(diagnostics.fallbackValid || 0)}`);
console.log(`fallbackUsed=${Boolean(diagnostics.fallbackUsed)}`);
console.log('');
console.log(`RESULT=${pass ? 'PASS' : 'FAIL'}`);

process.exitCode = pass ? 0 : 1;
