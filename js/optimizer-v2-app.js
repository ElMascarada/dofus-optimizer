import { APP_VERSION, TURN_MODES } from './config.js';
import { loadDofusData, loadSpellData } from './data-loader.js';
import {
  createOptimizerV2Request,
  formatOptimizerV2FmSummary,
  OPTIMIZER_V2_ELEMENTS
} from './optimizer-v2-orchestrator.js';
import { SearchMemoryRepository } from './search-memory/search-repository.js';
import { createSearchVersions, normalizeSearchQuery } from './search-memory/search-query.js';
import { mergeSeedDescriptors, seedDescriptorsFromNearby } from './search-memory/search-seeds.js';
import { mergeSearchOutputs, withExactCacheDiagnostics } from './search-memory/search-result-merge.js';
import { createWorkshopBuildFromOptimizerResult } from './workshop/workshop-build.js';
import { workshopOptimizationContext } from './workshop/workshop-optimization.js';
import { FIND_BETTER_BUILD_EVENT, OPEN_WORKSHOP_BUILD_EVENT } from './workshop/workshop-events.js';
import { optimizerApMpTruth } from './optimizer-v2-result-truth.js';

const $ = (selector) => document.querySelector(selector);
const classSelect = $('#optimizer-class');
const elementSelect = $('#optimizer-element');
const turnSelect = $('#optimizer-turn-mode');
const optimizeButton = $('#optimizer-run');
const resultsRoot = $('#optimizer-results');
const diagnosticsRoot = $('#optimizer-diagnostics');
const dataStatus = $('#optimizer-data-status');
const refinementContext = $('#optimizer-refinement-context');

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
const FM_CONTROL_IDS = Object.freeze([
  'optimizer-fm-exo-ap',
  'optimizer-fm-exo-mp',
  'optimizer-fm-spell-damage',
  'optimizer-fm-crit-damage'
]);

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
let currentPersistentLockedItemsBySlot = {};
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

function signedFmt(value) {
  const number = Number(value || 0);
  return `${number >= 0 ? '+' : ''}${fmt(number)}`;
}

function readNumber(id) {
  const value = Number(document.getElementById(id)?.value || 0);
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function readConstraints() {
  return Object.fromEntries(Object.entries(CONSTRAINT_INPUTS).map(([key, id]) => [key, readNumber(id)]));
}

function readFmPolicy() {
  return {
    exoAp: readNumber('optimizer-fm-exo-ap') === 1 ? 1 : 0,
    exoMp: readNumber('optimizer-fm-exo-mp') === 1 ? 1 : 0,
    spellDamagePct: readNumber('optimizer-fm-spell-damage') === 1 ? 3 : 0,
    allowCritDamage: readNumber('optimizer-fm-crit-damage') === 1
  };
}

function activeTurns(turnMode) {
  if (turnMode === 't1') return [1];
  if (turnMode === 't2') return [2];
  if (turnMode === 't3') return [3];
  return [1, 2, 3];
}

function stateMarkup(kind, title, message) {
  return `<div class="ui-state" data-state="${escapeHtml(kind)}"${kind === 'error' ? ' role="alert"' : ''}><strong>${escapeHtml(title)}</strong><span>${escapeHtml(message)}</span></div>`;
}

function renderState(kind, title, message) {
  displayedBuilds = [];
  resultsRoot.dataset.state = kind;
  resultsRoot.setAttribute('aria-busy', String(kind === 'loading'));
  resultsRoot.innerHTML = stateMarkup(kind, title, message);
}

function setRefinementContext(refinement = null) {
  activeRefinement = refinement;
  if (!refinement) {
    refinementContext.hidden = true;
    refinementContext.textContent = '';
    return;
  }
  const locks = Object.keys(refinement.lockedItemsBySlot || {}).length;
  const required = Object.keys(refinement.searchRequiredItemsBySlot || {}).length;
  const rejects = refinement.rejectedItemIds?.length || 0;
  refinementContext.hidden = false;
  refinementContext.innerHTML = refinement.mode === 'fill-missing'
    ? `<strong>Compléter depuis l’Atelier</strong> · ${required} item${required > 1 ? 's' : ''} conservé${required > 1 ? 's' : ''} · ${rejects} rejet${rejects > 1 ? 's' : ''}. Les slots vides restent libres.`
    : `<strong>Optimisation depuis l’Atelier</strong> · ${locks} item${locks > 1 ? 's' : ''} verrouillé${locks > 1 ? 's' : ''} · ${rejects} rejet${rejects > 1 ? 's' : ''}. Les autres slots restent libres de changer.`;
}

function setSearchControlsDisabled(disabled) {
  classSelect.disabled = disabled || !(dataset && spellData);
  elementSelect.disabled = disabled;
  turnSelect.disabled = disabled;
  for (const id of Object.values(CONSTRAINT_INPUTS)) document.getElementById(id).disabled = disabled;
  for (const id of FM_CONTROL_IDS) document.getElementById(id).disabled = disabled;
}

function setSearchingUi(searching, label = '') {
  optimizeButton.classList.toggle('is-searching', searching);
  optimizeButton.setAttribute('aria-busy', String(searching));
  optimizeButton.textContent = searching ? 'Arrêter la recherche' : 'Optimiser';
  if (searching && label) diagnosticsRoot.textContent = label;
}

function renderBuild(build, index) {
  const itemRows = (build.items || []).map((item) => `<li>${escapeHtml(item.name)}</li>`).join('');
  const turns = activeTurns(currentPayload?.turnMode || turnSelect.value)
    .map((turn) => `<span>T${turn} <b>${fmt(build.perTurn?.[turn])}</b></span>`)
    .join('');
  const apMpTruth = optimizerApMpTruth(build);
  const t1Truth = apMpTruth.t1
    ? `<div class="optimizer-v2-t1-effective"><span><strong>Bonus T1</strong> : <b>${signedFmt(apMpTruth.t1.bonusAp)} PA · ${signedFmt(apMpTruth.t1.bonusMp)} PM</b></span><span><strong>PA/PM au T1</strong> : <b>${fmt(apMpTruth.t1.ap)} PA · ${fmt(apMpTruth.t1.mp)} PM</b> <small>disponibles avant actions</small></span></div>`
    : '';
  return `
    <article class="optimizer-v2-result-card">
      <header><span class="rank">#${index + 1}</span><div><strong>${fmt(build.score)}</strong><small>score de l’objectif sélectionné</small></div></header>
      <div class="optimizer-v2-turns">${turns}</div>
      ${t1Truth}
      <div class="optimizer-v2-stats">
        <span>PA permanents <b>${fmt(apMpTruth.permanentAp)}</b></span>
        <span>PM permanents <b>${fmt(apMpTruth.permanentMp)}</b></span>
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
      <details><summary>Voir les 16 équipements</summary><ul class="optimizer-v2-gear">${itemRows}</ul></details>
      <button type="button" class="optimizer-v2-open-workshop" data-open-build="${index}">Ouvrir et ajuster dans l’Atelier</button>
    </article>`;
}

function renderResults(builds = [], emptyText = 'Aucun stuff certifié ne satisfait ces contraintes.') {
  displayedBuilds = Array.isArray(builds) ? builds : [];
  resultsRoot.setAttribute('aria-busy', 'false');
  if (displayedBuilds.length) {
    resultsRoot.dataset.state = 'results';
    const fmSummary = `<p class="hint optimizer-v2-fm-summary">${escapeHtml(formatOptimizerV2FmSummary(currentPayload?.fmPolicy))}</p>`;
    resultsRoot.innerHTML = fmSummary + displayedBuilds.map(renderBuild).join('');
    return;
  }
  renderState('empty', 'Aucun stuff trouvé', emptyText);
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
  setSearchControlsDisabled(false);
  optimizeButton.disabled = !(dataset && spellData && classSelect.value);
  setSearchingUi(false);
  resultsRoot.setAttribute('aria-busy', 'false');
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
  renderResults(partial.results, 'Aucun stuff valide n’avait encore été trouvé au moment de l’arrêt.');
  diagnosticsRoot.textContent = partial.results.length
    ? `Recherche arrêtée · ${partial.results.length} résultat${partial.results.length > 1 ? 's' : ''} conservé${partial.results.length > 1 ? 's' : ''}.`
    : 'Recherche arrêtée sans résultat validé.';
  setIdle();
}

function finalDiagnostics(output = {}) {
  const combat = output.diagnostics?.combatRefine;
  const memory = output.diagnostics?.searchMemory || {};
  const attempted = Number(memory.seedsAttempted || 0);
  const validSeeds = Number(memory.seedsValid || 0);
  const memoryLabel = memory.cacheHit
    ? 'mémoire instantanée'
    : `${validSeeds}/${attempted} piste${attempted > 1 ? 's' : ''} réutilisée${validSeeds > 1 ? 's' : ''}`;
  const locks = currentPayload?.requiredItemIds?.length || 0;
  const rejects = currentPayload?.rejectedItemIds?.length || 0;
  return `${Number(output.diagnostics?.visited || 0).toLocaleString('fr-FR')} builds complets · ${Number(output.diagnostics?.nodes || 0).toLocaleString('fr-FR')} nœuds${combat ? ` · ${Number(combat.evaluated || 0).toLocaleString('fr-FR')} rotations` : ''} · ${memoryLabel}${locks || rejects ? ` · ${locks} verrouillé${locks > 1 ? 's' : ''} · ${rejects} rejet${rejects > 1 ? 's' : ''}` : ''}`;
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
    diagnosticsRoot.textContent = `Recherche en cours · ${Number(progress.nodes || 0).toLocaleString('fr-FR')} nœuds explorés · meilleur score ${fmt(progress.best)}.`;
    return;
  }
  if (message.type === 'error') {
    renderState('error', 'Erreur de calcul', message.message || 'Le solveur a interrompu la recherche.');
    diagnosticsRoot.textContent = 'La recherche a été interrompue. Les paramètres restent disponibles pour réessayer.';
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
  setSearchControlsDisabled(true);
  optimizeButton.disabled = true;
  setSearchingUi(true, 'Vérification de la mémoire de recherche…');
  renderState('loading', 'Préparation de la recherche', 'Vérification des résultats compatibles déjà connus avant de lancer un nouveau calcul.');

  try {
    currentPersistentLockedItemsBySlot = { ...(refinement?.lockedItemsBySlot || {}) };
    const payload = createOptimizerV2Request({
      dataset,
      spellData,
      classId: classSelect.value,
      element: elementSelect.value,
      constraints: readConstraints(),
      fmPolicy: readFmPolicy(),
      turnMode: turnSelect.value,
      topN: 10,
      lockedItemsBySlot: refinement?.searchRequiredItemsBySlot || {},
      rejectedItemIds: refinement?.rejectedItemIds || []
    });
    if (!payload.classSpells.some((spell) => (spell.hits || []).length > 0)) {
      renderState('empty', 'Aucun sort offensif disponible', `Aucun sort ${ELEMENT_LABELS[elementSelect.value] || elementSelect.value} certifié n’est disponible pour cette classe.`);
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
        diagnosticsRoot.textContent = `Résultat instantané · mémoire compatible · ${output.results?.length || 0} build${output.results?.length > 1 ? 's' : ''}.`;
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
      setSearchingUi(true);
      diagnosticsRoot.textContent = `Mémoire compatible · comparaison avec le stuff Atelier · ${payload.requiredItemIds.length} verrouillé${payload.requiredItemIds.length > 1 ? 's' : ''} · ${payload.rejectedItemIds.length} rejet${payload.rejectedItemIds.length > 1 ? 's' : ''}.`;
      renderState('loading', 'Comparaison avec le stuff Atelier', 'Le résultat mémorisé est comparé au build courant avec les mêmes règles et données.');
      finalizeIfReady(requestId);
      return;
    }

    worker = new Worker(new URL('./optimizer-worker.js', import.meta.url), { type: 'module' });
    worker.addEventListener('message', (event) => handleWorkerMessage(event, requestId));
    worker.addEventListener('error', (event) => {
      if (requestId !== activeRequestId) return;
      renderState('error', 'Worker interrompu', event.message || 'Le calcul n’a pas pu continuer.');
      diagnosticsRoot.textContent = 'Le calcul a été interrompu. Réessaie avec les mêmes paramètres.';
      setIdle();
    });

    startSeedWorker(requestId, payload, seedBuilds);

    optimizeButton.disabled = false;
    setSearchingUi(true);
    renderState('loading', 'Recherche en cours', 'Exploration des builds complets, puis validation des meilleurs candidats. Tu peux arrêter et conserver les meilleurs résultats déjà trouvés.');
    diagnosticsRoot.textContent = `${ELEMENT_LABELS[payload.combatObjective.element]} · ${TURN_MODES.find(([id]) => id === payload.turnMode)?.[1] || payload.turnMode} · ${payload.classSpells.length} sorts · mémoire ${memoryError ? 'indisponible' : 'sans résultat exact'} · ${seedBuilds.length} piste${seedBuilds.length > 1 ? 's' : ''} réutilisée${seedBuilds.length > 1 ? 's' : ''}.`;
    worker.postMessage({ type: 'optimize', requestId, payload });
  } catch (error) {
    if (requestId !== activeRequestId) return;
    renderState('error', 'Recherche impossible', error instanceof Error ? error.message : String(error));
    diagnosticsRoot.textContent = 'Vérifie les paramètres puis réessaie.';
    setIdle();
  }
}

async function findBetter(build) {
  const refinement = workshopOptimizationContext(build);
  const requiredCount = Object.keys(refinement.searchRequiredItemsBySlot || {}).length;
  const canRun = refinement.mode === 'improve-complete'
    ? Boolean(refinement.seedBuild)
    : requiredCount > 0;
  if (!refinement.classId || !canRun) {
    diagnosticsRoot.textContent = 'L’optimisation Atelier nécessite une classe et au moins un item équipé.';
    return;
  }
  if (isSearching()) stopSearch();
  setRefinementContext(refinement);
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
      lockedItemsBySlot: currentPersistentLockedItemsBySlot,
      rejectedItemIds: currentPayload.rejectedItemIds
    });
    document.dispatchEvent(new CustomEvent(OPEN_WORKSHOP_BUILD_EVENT, { detail: { build } }));
  } catch (error) {
    diagnosticsRoot.textContent = error instanceof Error ? error.message : String(error);
  }
});

async function init() {
  optimizeButton.disabled = true;
  dataStatus.dataset.state = 'loading';
  elementSelect.innerHTML = OPTIMIZER_V2_ELEMENTS.map(([id, label]) => `<option value="${id}">${label}</option>`).join('');
  turnSelect.innerHTML = TURN_MODES.map(([id, label]) => `<option value="${id}">${label}</option>`).join('');
  turnSelect.value = 'sum';
  try {
    [dataset, spellData] = await Promise.all([loadDofusData(), loadSpellData()]);
    classSelect.innerHTML = '<option value="">Choisir une classe</option>'
      + spellData.breeds.map((breed) => `<option value="${breed.id}">${escapeHtml(breed.name)}</option>`).join('');
    classSelect.disabled = false;
    dataStatus.dataset.state = 'ready';
    dataStatus.textContent = `${dataset.items.length.toLocaleString('fr-FR')} équipements · ${spellData.spells.length.toLocaleString('fr-FR')} sorts · moteur V${APP_VERSION}`;
    renderState('empty', 'Prêt à optimiser', 'Choisis une classe, un élément, tes contraintes et l’objectif temporel, puis lance la recherche.');
    diagnosticsRoot.textContent = 'Prêt · sélectionne une classe pour activer Optimiser.';
    if (queuedFindBetterBuild) {
      const build = queuedFindBetterBuild;
      queuedFindBetterBuild = null;
      await findBetter(build);
    }
  } catch (error) {
    dataStatus.dataset.state = 'error';
    dataStatus.textContent = 'Données indisponibles';
    classSelect.disabled = true;
    renderState('error', 'Données certifiées indisponibles', 'L’Optimiseur ne peut pas démarrer sans les catalogues certifiés. Recharge la page pour réessayer.');
    diagnosticsRoot.textContent = error instanceof Error ? error.message : String(error);
  }
}

classSelect.addEventListener('change', () => {
  if (isSearching()) stopSearch();
  setRefinementContext(null);
  optimizeButton.disabled = !(dataset && spellData && classSelect.value);
  diagnosticsRoot.textContent = classSelect.value ? 'Classe sélectionnée · prêt à optimiser.' : 'Sélectionne une classe pour continuer.';
});
optimizeButton.addEventListener('click', () => {
  if (isSearching()) return stopSearch();
  setRefinementContext(null);
  runSearch();
});
init();