import { APP_VERSION, TURN_MODES } from './config.js';
import { loadDofusData, loadSpellData } from './data-loader.js';
import {
  createOptimizerV2Request,
  OPTIMIZER_V2_ELEMENTS
} from './optimizer-v2-orchestrator.js';
import { createWorkshopBuildFromOptimizerResult } from './workshop/workshop-build.js';
import { OPEN_WORKSHOP_BUILD_EVENT } from './workshop/workshop-events.js';

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
let activeRequestId = 0;
let displayedBuilds = [];
let latestPartialResults = [];
let currentPayload = null;

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

function setIdle() {
  const finished = worker;
  worker = null;
  if (finished) finished.terminate();
  optimizeButton.disabled = !(dataset && spellData && classSelect.value);
  optimizeButton.textContent = 'Optimiser';
}

function stopSearch() {
  if (!worker) return;
  worker.terminate();
  worker = null;
  activeRequestId++;
  renderResults(latestPartialResults, 'Aucun build valide trouvé avant l’arrêt.');
  diagnosticsRoot.textContent = latestPartialResults.length
    ? `Recherche arrêtée · ${latestPartialResults.length} résultat${latestPartialResults.length > 1 ? 's' : ''} conservé${latestPartialResults.length > 1 ? 's' : ''}.`
    : 'Recherche arrêtée.';
  setIdle();
}

function handleWorkerMessage(event, requestId) {
  const message = event.data || {};
  if (requestId !== activeRequestId || message.requestId !== requestId) return;
  if (message.type === 'progress') {
    const progress = message.progress || {};
    if (Array.isArray(progress.partialResults) && progress.partialResults.length) latestPartialResults = progress.partialResults;
    diagnosticsRoot.textContent = `${Number(progress.nodes || 0).toLocaleString('fr-FR')} nœuds · meilleur ${fmt(progress.best)}`;
    return;
  }
  if (message.type === 'error') {
    renderResults([], `Erreur de calcul : ${message.message || 'inconnue'}`);
    diagnosticsRoot.textContent = 'Le solveur a interrompu la recherche.';
    setIdle();
    return;
  }
  if (message.type !== 'result') return;
  const output = message.output || {};
  latestPartialResults = output.results || [];
  renderResults(output.results || []);
  const combat = output.diagnostics?.combatRefine;
  diagnosticsRoot.textContent = `${Number(output.diagnostics?.visited || 0).toLocaleString('fr-FR')} builds complets · ${Number(output.diagnostics?.nodes || 0).toLocaleString('fr-FR')} nœuds${combat ? ` · ${Number(combat.evaluated || 0).toLocaleString('fr-FR')} rotations` : ''}`;
  setIdle();
}

function runSearch() {
  if (worker) return stopSearch();
  if (!dataset || !spellData) return;
  try {
    const payload = createOptimizerV2Request({
      dataset,
      spellData,
      classId: classSelect.value,
      element: elementSelect.value,
      constraints: readConstraints(),
      turnMode: turnSelect.value,
      topN: 10
    });
    if (!payload.classSpells.some((spell) => (spell.hits || []).length > 0)) {
      renderResults([], `Aucun sort offensif ${ELEMENT_LABELS[elementSelect.value] || elementSelect.value} certifié pour cette classe.`);
      return;
    }

    currentPayload = payload;
    latestPartialResults = [];
    displayedBuilds = [];
    const requestId = ++activeRequestId;
    worker = new Worker(new URL('./optimizer-worker.js', import.meta.url), { type: 'module' });
    worker.addEventListener('message', (event) => handleWorkerMessage(event, requestId));
    worker.addEventListener('error', (event) => {
      if (requestId !== activeRequestId) return;
      renderResults([], `Erreur du worker : ${event.message || 'inconnue'}`);
      diagnosticsRoot.textContent = 'Le calcul a été interrompu.';
      setIdle();
    });

    optimizeButton.textContent = 'Arrêter';
    resultsRoot.innerHTML = '<div class="empty">Recherche en cours…</div>';
    diagnosticsRoot.textContent = `${ELEMENT_LABELS[payload.combatObjective.element]} · ${TURN_MODES.find(([id]) => id === payload.turnMode)?.[1] || payload.turnMode} · ${payload.classSpells.length} sorts disponibles.`;
    worker.postMessage({ type: 'optimize', requestId, payload });
  } catch (error) {
    renderResults([], error instanceof Error ? error.message : String(error));
  }
}

resultsRoot.addEventListener('click', (event) => {
  const button = event.target.closest('[data-open-build]');
  if (!button) return;
  const result = displayedBuilds[Number(button.dataset.openBuild)];
  if (!result || !currentPayload) return;
  try {
    const build = createWorkshopBuildFromOptimizerResult({
      result,
      classId: classSelect.value,
      fmPolicy: currentPayload.fmPolicy
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
  } catch (error) {
    dataStatus.textContent = error instanceof Error ? error.message : String(error);
    resultsRoot.innerHTML = '<div class="empty">Impossible de charger les données certifiées.</div>';
  }
}

classSelect.addEventListener('change', () => {
  if (worker) stopSearch();
  optimizeButton.disabled = !(dataset && spellData && classSelect.value);
});
optimizeButton.addEventListener('click', runSearch);
init();
