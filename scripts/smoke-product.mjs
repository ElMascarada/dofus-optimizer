import { readFileSync } from 'node:fs';

import { evaluateCompleteBuild } from '../js/complete-build-evaluator.js';
import { createOptimizerV2Request } from '../js/optimizer-v2-orchestrator.js';
import { validateDofusSnapshot, validateSpellSnapshot } from '../js/data-loader.js';
import {
  createWorkshopBuildFromOptimizerResult,
  workshopBuildIsComplete
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
let workshopStatus = best ? 'FAIL' : 'UNKNOWN';
if (best) {
  try {
    const workshopBuild = createWorkshopBuildFromOptimizerResult({
      result: best,
      classId: request.classId,
      fmPolicy: request.fmPolicy
    });
    workshop = evaluateWorkshopBuild({ build: workshopBuild, dataset, spellData });
    workshopStatus = workshop.valid && workshopBuildIsComplete(workshopBuild) ? 'PASS' : 'FAIL';
  } catch {
    workshopStatus = 'FAIL';
  }
}

const finalStats = workshop?.stats || best?.stats || {};
const workshopTurns = workshopStatus === 'PASS' ? analyzeWorkshopTurns(workshop) : null;
const t1 = workshopTurns?.turns?.find((entry) => Number(entry?.turn) === 1) || null;
const t1Sequence = t1?.actions || [];
const t1Damage = Number(t1?.damage || 0);
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
  && spellBreakdownPass;

console.log('PRODUCT_SMOKE');
console.log('scenario=Iop/Earth/T1/12AP/6MP/0Initiative');
console.log('');
console.log(`optimizerResults=${results.length}`);
console.log(`bestScore=${best ? number(best.score) : 'UNKNOWN'}`);
console.log('');
console.log(`buildLegal=${buildLegal ? 'PASS' : 'FAIL'}`);
console.log(`workshopLegal=${workshopStatus}`);
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
console.log(`primaryValid=${number(diagnostics.valid || 0)}`);
console.log(`fallbackValid=${number(diagnostics.fallbackValid || 0)}`);
console.log(`fallbackUsed=${Boolean(diagnostics.fallbackUsed)}`);
console.log('');
console.log(`RESULT=${pass ? 'PASS' : 'FAIL'}`);

process.exitCode = pass ? 0 : 1;
