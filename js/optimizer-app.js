import { loadDofusData } from './data-loader.js';
import { createWorkshopBuildFromOptimizerResult } from './workshop/workshop-build.js';
import { workshopOptimizationContext } from './workshop/workshop-optimization.js';
import {
  FIND_BETTER_BUILD_EVENT,
  OPEN_WORKSHOP_BUILD_EVENT
} from './workshop/workshop-events.js';

const ELEMENT_LABELS = Object.freeze({
  earth: 'Terre',
  fire: 'Feu',
  water: 'Eau',
  air: 'Air',
  multi: 'Multi'
});

const PROFILE_LABELS = Object.freeze({
  small: 'SMALL',
  medium: 'MEDIUM',
  large: 'LARGE'
});

const RESULT_STATS = Object.freeze([
  ['ap', 'PA'],
  ['mp', 'PM'],
  ['range', 'PO'],
  ['vit', 'Vitalité'],
  ['initiative', 'Initiative'],
  ['earth', 'Force'],
  ['fire', 'Intelligence'],
  ['water', 'Chance'],
  ['air', 'Agilité'],
  ['power', 'Puissance'],
  ['crit', 'Crit'],
  ['critDamage', 'Do Crit'],
  ['damage', 'Dommages'],
  ['damageEarth', 'Do Terre'],
  ['damageFire', 'Do Feu'],
  ['damageWater', 'Do Eau'],
  ['damageAir', 'Do Air']
]);

const ui = {
  optimizerTab: document.querySelector('[data-product-tab="optimizer"]'),
  workshopTab: document.querySelector('[data-product-tab="workshop"]'),
  optimizerView: document.querySelector('#optimizer-view'),
  workshopView: document.querySelector('#workshop-view'),
  dataStatus: document.querySelector('#optimizer-data-status'),
  refinement: document.querySelector('#optimizer-refinement-context'),
  run: document.querySelector('#optimizer-run'),
  diagnostics: document.querySelector('#optimizer-diagnostics'),
  results: document.querySelector('#optimizer-results'),
  topN: document.querySelector('#optimizer-top-n'),
  exoAp: document.querySelector('#optimizer-fm-exo-ap'),
  exoMp: document.querySelector('#optimizer-fm-exo-mp')
};

let dataset = null;
let worker = null;
let activeRequestId = 0;
let refinement = {
  requiredItemIds: [],
  rejectedItemIds: []
};

function activateTab(name) {
  const optimizer = name === 'optimizer';
  ui.optimizerView.hidden = !optimizer;
  ui.workshopView.hidden = optimizer;
  ui.optimizerTab.classList.toggle('is-active', optimizer);
  ui.workshopTab.classList.toggle('is-active', !optimizer);
  ui.optimizerTab.setAttribute('aria-selected', String(optimizer));
  ui.workshopTab.setAttribute('aria-selected', String(!optimizer));
  ui.optimizerTab.tabIndex = optimizer ? 0 : -1;
  ui.workshopTab.tabIndex = optimizer ? -1 : 0;
}

ui.optimizerTab?.addEventListener('click', () => activateTab('optimizer'));
ui.workshopTab?.addEventListener('click', () => activateTab('workshop'));

function numberValue(selector) {
  const number = Number(document.querySelector(selector)?.value || 0);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

function normalizedIds(values = []) {
  return [...new Set((values || []).map((value) => String(value || '').trim()).filter(Boolean))].sort();
}

function readSyntheticOffense() {
  const multi = Boolean(document.querySelector('#optimizer-element-multi')?.checked);
  const mono = [...document.querySelectorAll('[data-optimizer-element]')]
    .filter((input) => input.checked)
    .map((input) => input.value);

  if (multi && mono.length) throw new Error('Multi est exclusif : désactive les éléments mono.');
  if (!multi && (mono.length < 1 || mono.length > 3)) {
    throw new Error('Sélectionne entre 1 et 3 éléments, ou Multi.');
  }

  const profiles = [...document.querySelectorAll('[data-optimizer-profile]')]
    .filter((input) => input.checked)
    .map((input) => input.value);
  if (!profiles.length) throw new Error('Sélectionne au moins un profil synthétique.');

  return {
    elements: multi ? ['multi'] : mono,
    profiles
  };
}

function readConstraints() {
  return {
    ap: numberValue('#optimizer-min-ap'),
    mp: numberValue('#optimizer-min-mp'),
    range: numberValue('#optimizer-min-range'),
    vit: numberValue('#optimizer-min-vit'),
    initiative: numberValue('#optimizer-min-initiative'),
    resEarth: numberValue('#optimizer-res-earth'),
    resFire: numberValue('#optimizer-res-fire'),
    resWater: numberValue('#optimizer-res-water'),
    resAir: numberValue('#optimizer-res-air')
  };
}

function readFmPolicy() {
  return {
    exoAp: Number(ui.exoAp?.value || 0) === 1 ? 1 : 0,
    exoMp: Number(ui.exoMp?.value || 0) === 1 ? 1 : 0
  };
}

function requestPayload() {
  return {
    items: dataset?.items || [],
    sets: dataset?.sets || [],
    constraints: readConstraints(),
    fmPolicy: readFmPolicy(),
    syntheticOffense: readSyntheticOffense(),
    requiredItemIds: normalizedIds(refinement.requiredItemIds),
    rejectedItemIds: normalizedIds(refinement.rejectedItemIds),
    topN: Math.max(1, Math.min(50, Number(ui.topN?.value || 10))),
    searchProfile: 'BALANCED'
  };
}

function setSearching(searching) {
  ui.run.classList.toggle('is-searching', searching);
  ui.run.textContent = searching ? 'Arrêter' : 'Optimiser';
  for (const element of document.querySelectorAll('#optimizer-view input, #optimizer-view select')) {
    element.disabled = searching;
  }
}

function fmt(value, digits = 2) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number.toLocaleString('fr-FR', { maximumFractionDigits: digits }) : '0';
}

function itemLabel(item) {
  return item?.name || item?.id || 'Item';
}

function renderResult(result, index) {
  const stats = result?.stats || {};
  const synthetic = result?.syntheticOffense || {};
  const items = result?.items || [];
  const allocation = result?.characteristics || {};
  const activeSets = result?.activeSets || [];
  const exos = result?.structuralExos || {};

  const statHtml = RESULT_STATS
    .filter(([key]) => Number(stats?.[key] || 0) !== 0 || ['ap', 'mp', 'range', 'vit', 'initiative'].includes(key))
    .map(([key, label]) => `<li><span>${label}</span><strong>${fmt(stats?.[key], 0)}</strong></li>`)
    .join('');

  const allocationHtml = Object.entries(allocation)
    .filter(([, value]) => Number(value || 0) !== 0)
    .map(([key, value]) => `<li>${ELEMENT_LABELS[key] || key} +${fmt(value, 0)}</li>`)
    .join('') || '<li>Aucune allocation élémentaire</li>';

  const setsHtml = activeSets.length
    ? activeSets.map((set) => `<li>${set?.name || set?.setName || set?.id || 'Panoplie'}${set?.count ? ` ×${set.count}` : ''}</li>`).join('')
    : '<li>Aucune panoplie active</li>';

  const itemsHtml = items
    .map((item) => `<li><strong>${itemLabel(item)}</strong>${item?.slot ? ` <span>· ${item.slot}</span>` : ''}</li>`)
    .join('');

  return `<article class="panel optimizer-result-card" data-optimizer-result="${index}"
      data-result-ap="${Number(stats.ap || 0)}"
      data-result-mp="${Number(stats.mp || 0)}"
      data-result-items="${items.length}">
    <div class="section-title">
      <div><span class="eyebrow">BUILD ${index + 1}</span><h3>Équipement complet</h3></div>
      <span class="pill">minimum ${fmt(synthetic.minimumScore ?? result.score)}</span>
    </div>
    <p class="optimizer-score-line"><strong>Score synthétique moyen : ${fmt(synthetic.meanScore)}</strong></p>
    <ul class="optimizer-result-stats">${statHtml}</ul>
    <div class="optimizer-result-columns">
      <div><h4>Équipement</h4><ul>${itemsHtml}</ul></div>
      <div><h4>Panoplies actives</h4><ul>${setsHtml}</ul>
      <h4>Caractéristiques</h4><ul>${allocationHtml}</ul>
      <h4>Exos structurels</h4><p>PA ${Number(exos.exoAp || 0)} · PM ${Number(exos.exoMp || 0)}</p></div>
    </div>
    <button type="button" class="secondary" data-open-workshop="${index}">Ouvrir dans l’Atelier</button>
  </article>`;
}

function renderResults(output) {
  const results = output?.results || [];
  ui.results.dataset.state = results.length ? 'ready' : 'empty';
  ui.results.setAttribute('aria-busy', 'false');

  if (!results.length) {
    const reason = output?.diagnostics?.reason ? ` · ${output.diagnostics.reason}` : '';
    ui.results.innerHTML = `<div class="ui-state" data-state="empty"><strong>Aucun équipement légal trouvé</strong><span>Assouplis les contraintes ou autorise un exo PA/PM${reason}.</span></div>`;
    return;
  }

  ui.results.innerHTML = results.map(renderResult).join('');
  ui.results.querySelectorAll('[data-open-workshop]').forEach((button) => {
    button.addEventListener('click', () => {
      const result = results[Number(button.dataset.openWorkshop)];
      const build = createWorkshopBuildFromOptimizerResult({
        result,
        fmPolicy: readFmPolicy()
      });
      document.dispatchEvent(new CustomEvent(OPEN_WORKSHOP_BUILD_EVENT, { detail: { build } }));
    });
  });
}

function stopSearch(message = 'Recherche arrêtée.') {
  worker?.terminate();
  worker = null;
  activeRequestId += 1;
  setSearching(false);
  ui.diagnostics.textContent = message;
}

function startSearch() {
  if (!dataset) return;
  if (worker) {
    stopSearch();
    return;
  }

  let payload;
  try {
    payload = requestPayload();
  } catch (error) {
    ui.diagnostics.textContent = error instanceof Error ? error.message : String(error);
    ui.results.dataset.state = 'error';
    return;
  }

  const requestId = ++activeRequestId;
  worker = new Worker('./js/optimizer-worker.js', { type: 'module' });
  setSearching(true);
  ui.results.dataset.state = 'loading';
  ui.results.setAttribute('aria-busy', 'true');
  ui.results.innerHTML = '<div class="ui-state" data-state="loading"><strong>Recherche Equipment-First</strong><span>Set-Core-First explore les architectures légales.</span></div>';
  ui.diagnostics.textContent = 'Recherche Equipment-First en cours…';

  worker.addEventListener('message', (event) => {
    const message = event.data || {};
    if (message.requestId !== requestId) return;
    if (message.type === 'progress') {
      const progress = message.progress || {};
      ui.diagnostics.textContent = progress.message || progress.label || 'Recherche en cours…';
      return;
    }
    if (message.type === 'error') {
      worker?.terminate();
      worker = null;
      setSearching(false);
      ui.results.dataset.state = 'error';
      ui.results.setAttribute('aria-busy', 'false');
      ui.results.innerHTML = `<div class="ui-state" data-state="error"><strong>Recherche impossible</strong><span>${message.message || 'Erreur Worker.'}</span></div>`;
      ui.diagnostics.textContent = message.message || 'Erreur Worker.';
      return;
    }
    if (message.type === 'result') {
      worker?.terminate();
      worker = null;
      setSearching(false);
      renderResults(message.output || {});
      const count = message.output?.results?.length || 0;
      ui.diagnostics.textContent = `${count} résultat${count > 1 ? 's' : ''} Equipment-First.`;
    }
  });

  worker.addEventListener('error', (event) => {
    worker?.terminate();
    worker = null;
    setSearching(false);
    ui.results.dataset.state = 'error';
    ui.results.setAttribute('aria-busy', 'false');
    ui.results.innerHTML = `<div class="ui-state" data-state="error"><strong>Worker interrompu</strong><span>${event.message || 'Erreur Worker.'}</span></div>`;
  });

  worker.postMessage({ type: 'optimize', requestId, payload });
}

function setMultiExclusive() {
  const multi = document.querySelector('#optimizer-element-multi');
  const mono = [...document.querySelectorAll('[data-optimizer-element]')];
  multi?.addEventListener('change', () => {
    if (multi.checked) mono.forEach((input) => { input.checked = false; });
  });
  mono.forEach((input) => input.addEventListener('change', () => {
    if (input.checked && multi) multi.checked = false;
    const selected = mono.filter((entry) => entry.checked);
    if (selected.length > 3) input.checked = false;
  }));
}

document.addEventListener(FIND_BETTER_BUILD_EVENT, (event) => {
  const build = event.detail?.build;
  if (!build) return;
  const context = workshopOptimizationContext(build);
  refinement = {
    requiredItemIds: normalizedIds(Object.values(context.searchRequiredItemsBySlot || {})),
    rejectedItemIds: normalizedIds(context.rejectedItemIds || [])
  };
  const requiredCount = refinement.requiredItemIds.length;
  const rejectedCount = refinement.rejectedItemIds.length;
  ui.refinement.hidden = false;
  ui.refinement.textContent = `Atelier → Optimiseur · ${requiredCount} item(s) imposé(s) · ${rejectedCount} rejet(s).`;
  activateTab('optimizer');
});

ui.run?.addEventListener('click', startSearch);
setMultiExclusive();

try {
  dataset = await loadDofusData();
  ui.dataStatus.dataset.state = 'ready';
  ui.dataStatus.textContent = `${dataset.items?.length || 0} équipements chargés · Equipment-First prêt`;
  ui.run.disabled = false;
  ui.results.dataset.state = 'ready';
  ui.results.setAttribute('aria-busy', 'false');
  ui.results.innerHTML = '<div class="ui-state" data-state="ready"><strong>Equipment-First prêt</strong><span>Choisis une orientation et au moins un profil synthétique, puis optimise.</span></div>';
  ui.diagnostics.textContent = 'Prêt.';
} catch (error) {
  ui.dataStatus.dataset.state = 'error';
  ui.dataStatus.textContent = 'Données équipement indisponibles';
  ui.results.dataset.state = 'error';
  ui.results.setAttribute('aria-busy', 'false');
  ui.results.innerHTML = `<div class="ui-state" data-state="error"><strong>Chargement impossible</strong><span>${error instanceof Error ? error.message : String(error)}</span></div>`;
  ui.diagnostics.textContent = 'Impossible de charger le catalogue équipement.';
}
