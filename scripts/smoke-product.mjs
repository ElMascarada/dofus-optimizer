import { readFileSync } from 'node:fs';

import { evaluateCompleteEquipmentBuild } from '../js/complete-equipment-build-evaluator.js';
import { validateDofusSnapshot } from '../js/data-loader.js';
import {
  createWorkshopBuildFromOptimizerResult,
  workshopBuildIsComplete
} from '../js/workshop/workshop-build.js';

const rawItems = JSON.parse(readFileSync(new URL('../data/normalized/dofus-data.json', import.meta.url), 'utf8'));
const dataset = validateDofusSnapshot(rawItems);

const constraints = {
  ap: 12,
  mp: 6,
  range: 0,
  vit: 0,
  initiative: 0,
  resEarth: 0,
  resFire: 0,
  resWater: 0,
  resAir: 0
};
const fmPolicy = { exoAp: 0, exoMp: 0 };
const syntheticOffense = { elements: ['earth'], profiles: ['large'] };
const request = {
  items: dataset.items,
  sets: dataset.sets,
  constraints,
  fmPolicy,
  syntheticOffense,
  requiredItemIds: [],
  rejectedItemIds: [],
  topN: 3,
  searchProfile: 'BALANCED'
};

let workerHandler = null;
const messages = [];
globalThis.self = {
  addEventListener(type, handler) {
    if (type === 'message') workerHandler = handler;
  },
  postMessage(message) {
    messages.push(message);
  }
};
await import('../js/optimizer-worker.js');

if (!workerHandler) throw new Error('Optimizer Worker Equipment-First indisponible hors UI.');
workerHandler({ data: { type: 'optimize', requestId: 'equipment-only-product-smoke-v1', payload: request } });

const resultMessage = messages.findLast((message) => message?.type === 'result');
const errorMessage = messages.findLast((message) => message?.type === 'error');
const output = resultMessage?.output || { results: [], diagnostics: {} };
const results = output.results || [];
const best = results[0] || null;
const stats = best?.stats || {};
const diagnostics = output.diagnostics || {};

let authoritative = null;
let authoritativeLegal = false;
let sameAuthoritativeIdentity = false;
if (best) {
  authoritative = evaluateCompleteEquipmentBuild({
    items: best.items || [],
    sets: dataset.sets || [],
    constraints,
    fmPolicy,
    syntheticOffense
  });
  authoritativeLegal = Boolean(authoritative?.result);
  sameAuthoritativeIdentity = Boolean(authoritative?.result)
    && String(authoritative.result.buildIdentity || '') === String(best.buildIdentity || '');
}

let workshopConversion = 'UNKNOWN';
let workshopComplete = 'UNKNOWN';
let workshopReason = 'NONE';
if (best) {
  try {
    const workshopBuild = createWorkshopBuildFromOptimizerResult({
      result: best,
      fmPolicy
    });
    workshopConversion = 'PASS';
    workshopComplete = workshopBuildIsComplete(workshopBuild) ? 'PASS' : 'FAIL';
  } catch (error) {
    workshopConversion = 'FAIL';
    workshopComplete = 'FAIL';
    workshopReason = error instanceof Error ? error.message : String(error);
  }
}

function number(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 'UNKNOWN';
  return Number.isInteger(parsed) ? String(parsed) : parsed.toFixed(3);
}

const searchMode = String(diagnostics.searchMode || diagnostics.mode || 'UNKNOWN');
const equipmentCount = Number(best?.items?.length || 0);
const ap = Number(stats.ap || 0);
const mp = Number(stats.mp || 0);
const minimum = Number(best?.syntheticOffense?.minimumScore ?? best?.score ?? NaN);
const mean = Number(best?.syntheticOffense?.meanScore ?? NaN);
const pass = !errorMessage
  && results.length > 0
  && equipmentCount === 16
  && ap === 12
  && mp === 6
  && Number.isFinite(minimum)
  && minimum > 0
  && Number.isFinite(mean)
  && mean > 0
  && authoritativeLegal
  && sameAuthoritativeIdentity
  && workshopConversion === 'PASS'
  && workshopComplete === 'PASS';

console.log('PRODUCT_SMOKE');
console.log('product=Equipment-First');
console.log('scenario=Earth/LARGE/12AP/6MP/0ExoAP/0ExoMP');
console.log('spellDataLoaded=NO');
console.log('classDependency=NO');
console.log('turnDependency=NO');
console.log('');
console.log(`optimizerResults=${results.length}`);
console.log(`searchMode=${searchMode}`);
console.log(`bestItems=${equipmentCount}`);
console.log(`bestItemNames=${best ? (best.items || []).map((item) => item.name || item.id).join(' | ') : 'UNKNOWN'}`);
console.log(`ap=${number(ap)}`);
console.log(`mp=${number(mp)}`);
console.log(`earth=${number(stats.earth)}`);
console.log(`power=${number(stats.power)}`);
console.log(`crit=${number(stats.crit)}`);
console.log(`critDamage=${number(stats.critDamage)}`);
console.log(`syntheticMinimum=${number(minimum)}`);
console.log(`syntheticMean=${number(mean)}`);
console.log('');
console.log(`authoritativeLegal=${authoritativeLegal ? 'PASS' : 'FAIL'}`);
console.log(`authoritativeIdentity=${sameAuthoritativeIdentity ? 'PASS' : 'FAIL'}`);
console.log(`workshopConversion=${workshopConversion}`);
console.log(`workshopComplete=${workshopComplete}`);
console.log(`workshopReason=${workshopReason}`);
console.log(`evaluated=${number(diagnostics.evaluated)}`);
console.log(`valid=${number(diagnostics.valid)}`);
console.log('');
console.log(`RESULT=${pass ? 'PASS' : 'FAIL'}`);

process.exitCode = pass ? 0 : 1;
