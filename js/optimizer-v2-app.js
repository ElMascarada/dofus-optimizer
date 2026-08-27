import { APP_VERSION, TURN_MODES } from './config.js';
import { loadDofusData, loadSpellData } from './data-loader.js';
import {
  createOptimizerV2Request,
  OPTIMIZER_V2_ELEMENTS
} from './optimizer-v2-orchestrator.js';
import { SearchMemoryRepository } from './search-memory/search-repository.js';
import { createSearchVersions, normalizeSearchQuery } from './search-memory/search-query.js';
import { mergeSeedDescriptors, seedDescriptorsFromNearby } from './search-memory/search-seeds.js';
import { mergeSearchOutputs, withExactCacheDiagnostics } from './search-memory/search-result-merge.js';
import { createWorkshopBuildFromOptimizerResult } from './workshop/workshop-build.js';
import { workshopOptimizationContext } from './workshop/workshop-optimization.js';
import { FIND_BETTER_BUILD_EVENT, OPEN_WORKSHOP_BUILD_EVENT } from './workshop/workshop-events.js';

const $ = (selector) => document.querySelector(selector);
const classSelect = $('#optimizer-class');
const elementSelect = $('#optimizer-element');
const turnSelect = $('#optimizer-turn-mode');
const optimizeButton = $('#optimizer-run');
const resultsRoot = $('#optimizer-results');
const diagnosticsRoot = $('#optimizer-diagnostics');
const dataStatus = $('#optimizer-data-status');

const ELEMENT_LABELS = Object.fromEntries(OPTIMIZER_V2_ELEMENTS);
const CONSTRAINT_INPUTS = Object.freeze({
  ap: 'optimizer-min-ap',
  mp: 'optimizer-min-mp',
  range: 'optimizer-min-range',
  vit: 'optimizer-min-vit',
  initiative: 'optimizer-min-initiative',
  resEarth: 'optimizer-res-earth',
  resFire: 'optimizer-res-fire',
  resWater: 'optimizer-res-water',
  resAir: 'optimizer-res-air'
});

let dataset = null;
let spellData = null;
let worker = null;
let seedWorker = null;
let preparing = false;
let activeRequestId = 0;
let displayedBuilds = [];
let latestPartialResults = [];
let latestSeedOutput = { results: [], diagnostics: {} };
let pendingMainOutput = null;
let pendingSeedOutput = null;
let currentPayload = null;
let currentQuery = null;
let currentMemoryContext = { fingerprint: '', nearbyRecords: 0, seedCount: 0 };
let activeRefinement = null;
let queuedFindBetterBuild = null;
const searchMemory = new SearchMemoryRepository();

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[char]));
}

function fmt(value) {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(Number(value || 0));
}

function readNumber(id) {
  const value = Number(document.getElementById(id)?.value || 0);
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function readConstraints() {
  return Object.fromEntries(Object.entries(CONSTRAINT_INPUTS).map(([key, id]) => [key, readNumber(id)]));
}

function activeTurns(turnMode) {
  if (turnMode === 't1') return [1];
  if (turnMode === 't2') return [2];
  if (turnMode === 't3') return [3];
  return [1, 2, 3];
}

function renderBuild(build, index) {
  const itemRows = (build.items || []).map((item) => `<li>${escapeHtml(item.name)}</li>`).join('');
  const turns = activeTurns(currentPayload?.turnMode || turnSelect.value)
    .map((turn) => `<span>T${turn} <b>${fmt(build.perTurn?.[turn])}</b></span>`)
    .join('');
  return `
    <article class="optimizer-v2-result-card">
      <header><span class="rank">#${index + 1}</span><div><strong>${fmt(build.score)}</strong><small>dégâts / score moteur</small></div></header>
      <div class="optimizer-v2-turns">${turns}</div>
      <div class="optimizer-v2-stats">
        <span>PA <b>${fmt(build.stats?.ap)}</b></span>
        <span>PM <b>${fmt(build.stats?.mp)}</b></span>
        <span>PO <b>${fmt(build.stats?.range)}</b></span>
        <span>Vitalité <b>${fmt(build.stats?.vit)}</b></span>
        <span>Initiative <b>${fmt(build.stats?.initiative)}</b></span>
        <span>Puissance <b>${fmt(build.stats?.power)}</b></span>
        <span>Terre <b>${fmt(build.stats?.earth)}</b></span>
        <span>Feu <b>${fmt(build.stats?.fire)}</b></span>
        <span>Eau <b>${fmt(build.stats?.water)}</b></span>
        <span>Air <b>${fmt(build.stats?.air)}</b></span>
        <span>Res Terre <b>${fmt(build.stats?.resEarth)}%</b></span>
        <span>Res Feu <b>${fmt(build.stats?.resFire)}%</b></span>
        <span>Res Eau <b>${fmt(build.stats?.resWater)}%</b></span>
        <span>Res Air <b>${fmt(build.stats?.resAir)}%</b></span>
      </div>
      <details><summary>Équipement</summary><ul class="optimizer-v2-gear">${itemRows}</ul></details>
      <button type="button" class="optimizer-v2-open-workshop" data-open-build="${index}">Ouvrir dans l’Atelier</button>
    </article>`;
}

function renderResults(builds = [], emptyText = 'Aucun build certifié ne satisfait les contraintes.') {
  displayedBuilds = Array.isArray(builds) ? builds : [];
  resultsRoot.innerHTML = displayedBuilds.length
    ? displayedBuilds.map(renderBuild).join('')
    : `<div class="empty">${escapeHtml(emptyText)}</div>`;
}

function isSearching() {
  return preparing || Boolean(worker) || Boolean(seedWorker);
}

function setIdle() {
  const main = worker;
  const seeds = seedWorker;
  worker = null;
  seedWorker = null;
  preparing = false;
  if (main) main.terminate();
  if (seeds) seeds.terminate();
  optimizeButton.disabled = !(dataset && spellData && classSelect.value);
  optimizeButton.textContent = 'Optimiser';
}

function stopSearch() {
  if (!isSearching()) return;
  activeRequestId++;
  const partial = mergeSearchOutputs(
    { results: latestPartialResults, diagnostics: { stoppedEarly: true } },
    latestSeedOutput,
    {
      topN: currentPayload?.topN || 10,
      diversityMode: currentPayload?.diversityMode || 'gear',
      ...currentMemoryContext
    }
  );
  renderResults(partial.results, 'Aucun build valide trouvé avant l’arrêt.');
  diagnosticsRoot.textContent = partial.results.length
    ? `Recherche arrêtée · ${partial.results.length} résultat${partial.results.length > 1 ? 's' : ''} conservé${partial.results.length > 1 ? 's' : ''}.`
    : 'Recherche arrêtée.';
  setIdle();
}

function finalDiagnostics(output = {}) {
  const combat = output.diagnostics?.combatRefine;
  const memory = output.diagnostics?.searchMemory || {};
  const memoryLabel = memory.cacheHit
    ? 'cache exact'
    : `${Number(memory.seedsValid || 0)}/${Number(memory.seedsAttempted || 0)} seeds valides`;
  const locks = currentPayload?.requiredItemIds?.length || 0;
  const rejects = currentPayload?.rejectedItemIds?.length || 0;
  return `${Number(output.diagnostics?.visited || 0).toLocaleString('fr-FR')} builds complets · ${Number(output.diagnostics?.nodes || 0).toLocaleString('fr-FR')} nœuds${combat ? ` · ${Number(combat.evaluated || 0).toLocaleString('fr-FR')} rotations` : ''} · ${memoryLabel}${locks || rejects ? ` · ${locks} lock · ${rejects} reject` : ''}`;
}

function finalizeIfReady(requestId) {
  if (requestId !== activeRequestId || !pendingMainOutput || pendingSeedOutput === null) return;
  const output = mergeSearchOutputs(pendingMainOutput, pendingSeedOutput, {
    topN: currentPayload?.topN || 10,
    diversityMode: currentPayload?.diversityMode || 'gear',
    ...currentMemoryContext
  });
  latestPartialResults = output.results || [];
  renderResults(output.results || []);
  diagnosticsRoot.textContent = finalDiagnostics(output);
  if (currentQuery) {
    searchMemory.remember(currentQuery, output).catch(() => {
      // La mémoire est une optimisation : une erreur IndexedDB ne bloque jamais un résultat valide.
    });
  }
  setIdle();
}

function handleWorkerMessage(event, requestId) {
  const message = event.data || {};
  if (requestId !== activeRequestId || message.requestId !== requestId) return;
  if (message.type === 'progress') {
    const progress = message.progress || {};
    if (Array.isArray(progress.partialResults) && progress.partialResults.length) latestPartialResults = progress.partialResults;
    diagnosticsRoot.textContent = `${Number(progress.nodes || 0).toLocaleString('fr-FR')} nœuds · meilleur ${fmt(progress.best)} · cache miss`;
    return;
  }
  if (message.type === 'error') {
    renderResults([], `Erreur de calcul : ${message.message || 'inconnue'}`);
    diagnosticsRoot.textContent = 'Le solveur a interrompu la recherche.';
    setIdle();
    return;
  }
  if (message.type !== 'result') return;
  pendingMainOutput = message.output || { results: [], diagnostics: {} };
  finalizeIfReady(requestId);
}

function handleSeedWorkerMessage(event, requestId) {
  const message = event.data || {};
  if (requestId !== activeRequestId || message.requestId !== requestId) return;
  if (message.type === 'seed-error') {
    pendingSeedOutput = {
      results: [],
      diagnostics: {
        seedEvaluation: {
          attempted: currentMemoryContext.seedCount,
          valid: 0,
          rejected: { 'seed-worker-error': currentMemoryContext.seedCount }
        }
      }
    };
    latestSeedOutput = pendingSeedOutput;
    finalizeIfReady(requestId);
    return;
  }
  if (message.type !== 'seed-result') return;
  pendingSeedOutput = message.output || { results: [], diagnostics: {} };
  latestSeedOutput = pendingSeedOutput;
  finalizeIfReady(requestId);
}

function startSeedWorker(requestId, payload, seedBuilds) {
  if (!seedBuilds.length) return;
  seedWorker = new Worker(new URL('./search-memory/seed-worker.js', import.meta.url), { type: 'module' });
  seedWorker.addEventListener('message', (event) => handleSeedWorkerMessage(event, requestId));
  seedWorker.addEventListener('error', () => {
    if (requestId !== activeRequestId) return;
    handleSeedWorkerMessage({ data: { type: 'seed-error', requestId } }, requestId);
  });
  seedWorker.postMessage({ type: 'evaluate-seeds', requestId, payload, seedBuilds });
}

async function runSearch(refinement = null) {
  if (isSearching()) return stopSearch();
  if (!dataset || !spellData) return;
  const requestId = ++activeRequestId;
  preparing = true;
  optimizeButton.disabled = true;
  optimizeButton.textContent = 'Vérification…';

  try {
    const payload = createOptimizerV2Request({
      dataset,
      spellData,
      classId: classSelect.value,
      element: elementSelect.value,
      constraints: readConstraints(),
      turnMode: turnSelect.value,
      topN: 10,
      lockedItemsBySlot: refinement?.lockedItemsBySlot || {},
      rejectedItemIds: refinement?.rejectedItemIds || []
    });
    if (!payload.classSpells.some((spell) => (spell.hits || []).length > 0)) {
      renderResults([], `Aucun sort offensif ${ELEMENT_LABELS[elementSelect.value] || elementSelect.value} certifié pour cette classe.`);
      setIdle();
      return;
    }

    currentPayload = payload;
    latestPartialResults = [];
    latestSeedOutput = { results: [], diagnostics: {} };
    displayedBuilds = [];
    pendingMainOutput = null;
    pendingSeedOutput = null;
    const versions = createSearchVersions({ dataset, spellData, rulesVersion: APP_VERSION });
    const query = normalizeSearchQuery({ payload, versions });
    currentQuery = query;

    let exact = null;
    let nearby = [];
    let memoryError = null;
    const workshopSeeds = refinement?.seedBuild ? [refinement.seedBuild] : [];
    try {
      exact = await searchMemory.recallExact(query, { items: dataset.items });
      if (requestId !== activeRequestId) return;
      if (exact.hit && !workshopSeeds.length) {
        const output = withExactCacheDiagnostics(exact.output, { fingerprint: exact.fingerprint });
        renderResults(output.results || []);
        diagnosticsRoot.textContent = `Résultat instantané · cache exact · ${output.results?.length || 0} build${output.results?.length > 1 ? 's' : ''}.`;
        setIdle();
        return;
      }
      if (!exact.hit) nearby = await searchMemory.findNearby(query, { limit: 5, maxDistance: 0.35 });
    } catch (error) {
      memoryError = error;
      exact = null;
      nearby = [];
    }
    if (requestId !== activeRequestId) return;

    const nearbySeeds = seedDescriptorsFromNearby(nearby, { maxBuilds: 8 });
    const seedBuilds = mergeSeedDescriptors([workshopSeeds, nearbySeeds], { maxBuilds: 8 });
    currentMemoryContext = {
      fingerprint: exact?.fingerprint || '',
      nearbyRecords: nearby.length,
      seedCount: seedBuilds.length
    };
    pendingSeedOutput = seedBuilds.length
      ? null
      : { results: [], diagnostics: { seedEvaluation: { attempted: 0, valid: 0, rejected: {} } } };
    preparing = false;

    if (exact?.hit) {
      pendingMainOutput = withExactCacheDiagnostics(exact.output, { fingerprint: exact.fingerprint });
      startSeedWorker(requestId, payload, seedBuilds);
      optimizeButton.disabled = false;
      optimizeButton.textContent = 'Arrêter';
      diagnosticsRoot.textContent = `Cache exact compatible · réévaluation du stuff Atelier comme lower bound · ${payload.requiredItemIds.length} lock · ${payload.rejectedItemIds.length} reject.`;
      finalizeIfReady(requestId);
      return;
    }

    worker = new Worker(new URL('./optimizer-worker.js', import.meta.url), { type: 'module' });
    worker.addEventListener('message', (event) => handleWorkerMessage(event, requestId));
    worker.addEventListener('error', (event) => {
      if (requestId !== activeRequestId) return;
      renderResults([], `Erreur du worker : ${event.message || 'inconnue'}`);
      diagnosticsRoot.textContent = 'Le calcul a été interrompu.';
      setIdle();
    });

    startSeedWorker(requestId, payload, seedBuilds);

    optimizeButton.disabled = false;
    optimizeButton.textContent = 'Arrêter';
    resultsRoot.innerHTML = '<div class="empty">Recherche en cours…</div>';
    diagnosticsRoot.textContent = `${ELEMENT_LABELS[payload.combatObjective.element]} · ${TURN_MODES.find(([id]) => id === payload.turnMode)?.[1] || payload.turnMode} · ${payload.classSpells.length} sorts · cache ${memoryError ? 'indisponible' : 'miss'} · ${seedBuilds.length} seed${seedBuilds.length > 1 ? 's' : ''} · ${payload.requiredItemIds.length} lock · ${payload.rejectedItemIds.length} reject.`;
    worker.postMessage({ type: 'optimize', requestId, payload });
  } catch (error) {
    if (requestId !== activeRequestId) return;
    renderResults([], error instanceof Error ? error.message : String(error));
    setIdle();
  }
}

async function findBetter(build) {
  const refinement = workshopOptimizationContext(build);
  if (!refinement.classId || !refinement.seedBuild) {
    diagnosticsRoot.textContent = 'Trouver mieux nécessite une classe et un stuff Atelier complet.';
    return;
  }
  if (isSearching()) stopSearch();
  activeRefinement = refinement;
  classSelect.value = refinement.classId;
  optimizeButton.disabled = false;
  await runSearch(refinement);
}

document.addEventListener(FIND_BETTER_BUILD_EVENT, (event) => {
  const build = event?.detail?.build;
  if (!build) return;
  if (!dataset || !spellData) queuedFindBetterBuild = build;
  else findBetter(build);
});

resultsRoot.addEventListener('click', (event) => {
  const button = event.target.closest('[data-open-build]');
  if (!button) return;
  const result = displayedBuilds[Number(button.dataset.openBuild)];
  if (!result || !currentPayload) return;
  try {
    const build = createWorkshopBuildFromOptimizerResult({
      result,
      classId: classSelect.value,
      fmPolicy: currentPayload.fmPolicy,
      lockedItemsBySlot: currentPayload.lockedItemsBySlot,
      rejectedItemIds: currentPayload.rejectedItemIds
    });
    document.dispatchEvent(new CustomEvent(OPEN_WORKSHOP_BUILD_EVENT, { detail: { build } }));
  } catch (error) {
    diagnosticsRoot.textContent = error instanceof Error ? error.message : String(error);
  }
});

async function init() {
  optimizeButton.disabled = true;
  elementSelect.innerHTML = OPTIMIZER_V2_ELEMENTS.map(([id, label]) => `<option value="${id}">${label}</option>`).join('');
  turnSelect.innerHTML = TURN_MODES.map(([id, label]) => `<option value="${id}">${label}</option>`).join('');
  turnSelect.value = 'sum';
  try {
    [dataset, spellData] = await Promise.all([loadDofusData(), loadSpellData()]);
    classSelect.innerHTML = '<option value="">Choisir une classe</option>'
      + spellData.breeds.map((breed) => `<option value="${breed.id}">${escapeHtml(breed.name)}</option>`).join('');
    classSelect.disabled = false;
    dataStatus.textContent = `${dataset.items.length.toLocaleString('fr-FR')} équipements · ${spellData.spells.length.toLocaleString('fr-FR')} sorts · moteur V${APP_VERSION}`;
    resultsRoot.innerHTML = '<div class="empty">Choisis une classe, un élément, tes contraintes et l’objectif temporel.</div>';
    if (queuedFindBetterBuild) {
      const build = queuedFindBetterBuild;
      queuedFindBetterBuild = null;
      await findBetter(build);
    }
  } catch (error) {
    dataStatus.textContent = error instanceof Error ? error.message : String(error);
    resultsRoot.innerHTML = '<div class="empty">Impossible de charger les données certifiées.</div>';
  }
}

classSelect.addEventListener('change', () => {
  if (isSearching()) stopSearch();
  activeRefinement = null;
  optimizeButton.disabled = !(dataset && spellData && classSelect.value);
});
optimizeButton.addEventListener('click', () => {
  if (isSearching()) return stopSearch();
  activeRefinement = null;
  runSearch();
});
init();
