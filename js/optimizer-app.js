import { loadDofusData } from './data-loader.js';
import { renderOptimizerResult } from './optimizer-result-view.js';
import { createWorkshopBuildFromOptimizerResult } from './workshop/workshop-build.js';
import { workshopOptimizationContext } from './workshop/workshop-optimization.js';
import {
  FIND_BETTER_BUILD_EVENT,
  OPEN_WORKSHOP_BUILD_EVENT
} from './workshop/workshop-events.js';

const CONSTRAINT_LABELS = Object.freeze({
  range: 'PO minimum',
  vit: 'Vitalité minimum',
  initiative: 'Initiative minimum',
  power: 'Puissance minimum',
  crit: 'Crit minimum',
  critDamage: 'Do Crit minimum',
  damage: 'Dommages fixes minimum',
  spellDamagePct: '% dommages sorts minimum',
  earth: 'Force minimum',
  fire: 'Intelligence minimum',
  water: 'Chance minimum',
  air: 'Agilité minimum',
  damageEarth: 'Do Terre minimum',
  damageFire: 'Do Feu minimum',
  damageWater: 'Do Eau minimum',
  damageAir: 'Do Air minimum',
  resEarth: '% Résistance Terre',
  resFire: '% Résistance Feu',
  resWater: '% Résistance Eau',
  resAir: '% Résistance Air',
  fm: 'FM'
});

const INTERNAL_RESULT_POOL = 50;
const DISPLAY_RESULT_LIMIT = 5;

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
  constraintKey: document.querySelector('#optimizer-constraint-key'),
  constraintValue: document.querySelector('#optimizer-constraint-value'),
  constraintNumberField: document.querySelector('#optimizer-constraint-number-field'),
  constraintFmField: document.querySelector('#optimizer-constraint-fm-field'),
  constraintFmValue: document.querySelector('#optimizer-constraint-fm-value'),
  constraintAdd: document.querySelector('#optimizer-constraint-add'),
  activeConstraints: document.querySelector('#optimizer-active-constraints')
};

let dataset = null;
let worker = null;
let activeRequestId = 0;
let refinement = {
  requiredItemIds: [],
  rejectedItemIds: []
};
const advancedConstraints = new Map([['fm', 1]]);

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

  const profile = document.querySelector('[data-optimizer-profile]:checked')?.value;
  if (!profile) throw new Error('Choisis un type de dégâts.');
  const critMode = document.querySelector('[data-optimizer-crit-mode]:checked')?.value || 'auto';

  return {
    elements: multi ? ['multi'] : mono,
    profiles: [profile],
    critMode
  };
}

function readConstraints() {
  const constraints = {
    ap: numberValue('#optimizer-min-ap'),
    mp: numberValue('#optimizer-min-mp')
  };
  for (const [key, value] of advancedConstraints) {
    if (key === 'fm') continue;
    const number = Number(value || 0);
    if (Number.isFinite(number) && number > 0) constraints[key] = number;
  }
  return constraints;
}

function readFmPolicy() {
  const enabled = Number(advancedConstraints.get('fm') || 0) === 1;
  return {
    enabled,
    fmEnabled: enabled,
    exoAp: enabled ? 1 : 0,
    exoMp: enabled ? 1 : 0
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
    topN: INTERNAL_RESULT_POOL,
    searchProfile: 'BALANCED'
  };
}

function setSearching(searching) {
  ui.run.classList.toggle('is-searching', searching);
  ui.run.textContent = searching ? 'Arrêter' : 'Optimiser';
  for (const element of document.querySelectorAll('#optimizer-view input, #optimizer-view select')) {
    element.disabled = searching;
  }
  if (ui.constraintAdd) ui.constraintAdd.disabled = searching;
  for (const button of document.querySelectorAll('[data-remove-optimizer-constraint]')) button.disabled = searching;
}

function coreItemIds(build) {
  return (build?.items || [])
    .filter((item) => item?.slot !== 'dofus')
    .map((item) => String(item?.id ?? ''));
}

function dofusItemIds(build) {
  return (build?.items || [])
    .filter((item) => item?.slot === 'dofus')
    .map((item) => String(item?.id ?? ''));
}

function multisetDifference(left = [], right = []) {
  const remaining = new Map();
  for (const id of right) remaining.set(id, Number(remaining.get(id) || 0) + 1);
  let shared = 0;
  for (const id of left) {
    const count = Number(remaining.get(id) || 0);
    if (count <= 0) continue;
    shared++;
    remaining.set(id, count - 1);
  }
  return Math.max(left.length, right.length) - shared;
}

function meaningfullyDifferent(left, right) {
  if (multisetDifference(coreItemIds(left), coreItemIds(right)) >= 3) return true;
  if (multisetDifference(dofusItemIds(left), dofusItemIds(right)) >= 3) return true;
  const leftArchitecture = left?.searchArchitecture || {};
  const rightArchitecture = right?.searchArchitecture || {};
  return Boolean(leftArchitecture.branch && rightArchitecture.branch
    && leftArchitecture.branch !== rightArchitecture.branch);
}

function selectDisplayedResults(results = []) {
  const selected = [];
  for (const result of results) {
    if (!selected.length || selected.every((other) => meaningfullyDifferent(result, other))) {
      selected.push(result);
    }
    if (selected.length >= DISPLAY_RESULT_LIMIT) break;
  }
  return selected;
}

function renderResults(output) {
  const results = selectDisplayedResults(output?.results || []);
  ui.results.dataset.state = results.length ? 'ready' : 'empty';
  ui.results.setAttribute('aria-busy', 'false');

  if (!results.length) {
    const reason = output?.diagnostics?.reason ? ` · ${output.diagnostics.reason}` : '';
    ui.results.innerHTML = `<div class="ui-state" data-state="empty"><strong>Aucun stuff légal trouvé</strong><span>Assouplis les contraintes${reason}.</span></div>`;
    return [];
  }

  ui.results.innerHTML = results.map((result, index) => renderOptimizerResult(result, index)).join('');
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
  return results;
}

function renderActiveConstraints() {
  if (!ui.activeConstraints) return;
  const entries = [...advancedConstraints.entries()];
  if (!entries.length) {
    ui.activeConstraints.innerHTML = '<span class="hint">Aucune contrainte avancée.</span>';
    return;
  }
  ui.activeConstraints.innerHTML = entries.map(([key, value]) => {
    const label = CONSTRAINT_LABELS[key] || key;
    const shown = key === 'fm' ? (Number(value) === 1 ? 'Oui' : 'Non') : `≥ ${Number(value).toLocaleString('fr-FR', { maximumFractionDigits: 0 })}`;
    return `<span class="optimizer-constraint-chip">${label} ${shown}<button type="button" data-remove-optimizer-constraint="${key}" aria-label="Retirer ${label}">×</button></span>`;
  }).join('');
  ui.activeConstraints.querySelectorAll('[data-remove-optimizer-constraint]').forEach((button) => {
    button.addEventListener('click', () => {
      advancedConstraints.delete(button.dataset.removeOptimizerConstraint);
      renderActiveConstraints();
    });
  });
}

function syncConstraintEditor() {
  const fm = ui.constraintKey?.value === 'fm';
  if (ui.constraintNumberField) ui.constraintNumberField.hidden = fm;
  if (ui.constraintFmField) ui.constraintFmField.hidden = !fm;
}

function addConstraintFromEditor() {
  const key = ui.constraintKey?.value || '';
  if (!key) return;
  const value = key === 'fm'
    ? (Number(ui.constraintFmValue?.value || 0) === 1 ? 1 : 0)
    : Math.max(0, Number(ui.constraintValue?.value || 0));
  if (key !== 'fm' && (!Number.isFinite(value) || value <= 0)) {
    ui.diagnostics.textContent = 'La valeur de la contrainte doit être supérieure à 0.';
    return;
  }
  advancedConstraints.set(key, value);
  renderActiveConstraints();
  if (ui.constraintKey) ui.constraintKey.value = '';
  if (ui.constraintValue) ui.constraintValue.value = '0';
  syncConstraintEditor();
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
  ui.results.innerHTML = '<div class="ui-state" data-state="loading"><strong>Recherche du meilleur stuff</strong><span>Comparaison des architectures, équipements et Dofus / trophées.</span></div>';
  ui.diagnostics.textContent = 'Recherche en cours…';

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
      const displayed = renderResults(message.output || {});
      const count = displayed.length;
      ui.diagnostics.textContent = `${count} stuff${count > 1 ? 's' : ''} pertinent${count > 1 ? 's' : ''} affiché${count > 1 ? 's' : ''}.`;
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
ui.constraintKey?.addEventListener('change', syncConstraintEditor);
ui.constraintAdd?.addEventListener('click', addConstraintFromEditor);
setMultiExclusive();
syncConstraintEditor();
renderActiveConstraints();

try {
  dataset = await loadDofusData();
  ui.dataStatus.dataset.state = 'ready';
  ui.dataStatus.textContent = `${dataset.items?.length || 0} équipements chargés · prêt`;
  ui.run.disabled = false;
  ui.results.dataset.state = 'ready';
  ui.results.setAttribute('aria-busy', 'false');
  ui.results.innerHTML = '<div class="ui-state" data-state="ready"><strong>Optimiseur prêt</strong><span>Choisis ton orientation offensive et tes contraintes.</span></div>';
  ui.diagnostics.textContent = 'Prêt.';
} catch (error) {
  ui.dataStatus.dataset.state = 'error';
  ui.dataStatus.textContent = 'Données équipement indisponibles';
  ui.results.dataset.state = 'error';
  ui.results.setAttribute('aria-busy', 'false');
  ui.results.innerHTML = `<div class="ui-state" data-state="error"><strong>Chargement impossible</strong><span>${error instanceof Error ? error.message : String(error)}</span></div>`;
  ui.diagnostics.textContent = 'Impossible de charger le catalogue équipement.';
}
