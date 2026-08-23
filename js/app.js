import { APP_VERSION, DEFAULT_CONSTRAINTS, DEFAULT_FM, TURN_MODES } from './config.js';
import { loadDofusData } from './data-loader.js';
import { SAMPLE_SPELLS } from './sample-data.js';

const $ = (selector) => document.querySelector(selector);
const spellList = $('#spell-list');
const results = $('#results');
const diagnostics = $('#diagnostics');
const optimizeButton = $('#optimize');
const dataStatus = $('#data-status');

let dataset = null;
let worker = null;
let activeRequestId = 0;

function renderSpellRows() {
  spellList.innerHTML = SAMPLE_SPELLS.map((spell, index) => `
    <div class="spell-row" data-spell-id="${spell.id}">
      <label class="check"><input type="checkbox" class="spell-enabled" ${index < 2 ? 'checked' : ''}> <span>${spell.name}</span></label>
      <label>Poids <input class="spell-weight" type="number" min="0" step="0.1" value="${index === 0 ? 1 : 0.7}"></label>
      <label>T1 <input class="cast-t1" type="number" min="0" max="6" value="1"></label>
      <label>T2 <input class="cast-t2" type="number" min="0" max="6" value="1"></label>
      <label>T3 <input class="cast-t3" type="number" min="0" max="6" value="1"></label>
    </div>
  `).join('');
}

function readSelections() {
  return [...document.querySelectorAll('.spell-row')].map((row) => {
    const spell = SAMPLE_SPELLS.find((s) => s.id === row.dataset.spellId);
    return {
      spell,
      enabled: row.querySelector('.spell-enabled').checked,
      weight: Number(row.querySelector('.spell-weight').value || 0),
      casts: {
        1: Number(row.querySelector('.cast-t1').value || 0),
        2: Number(row.querySelector('.cast-t2').value || 0),
        3: Number(row.querySelector('.cast-t3').value || 0)
      }
    };
  });
}

function readNumber(id) {
  return Number(document.getElementById(id).value || 0);
}

function readOptionalNumber(id) {
  const raw = document.getElementById(id)?.value?.trim();
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function readConstraints() {
  return {
    ap: readNumber('min-ap'),
    mp: readNumber('min-mp'),
    range: readNumber('min-range'),
    vit: readNumber('min-vit'),
    resEarth: readNumber('res-earth'),
    resFire: readNumber('res-fire'),
    resWater: readNumber('res-water'),
    resAir: readNumber('res-air')
  };
}

function readScenario() {
  const scenario = {};
  const fields = {
    farEnemiesOver9: readOptionalNumber('ctx-ratrapry-far'),
    pryximiteNearbyEnemiesStartT1: readOptionalNumber('ctx-pryximite-start'),
    pryximiteNearbyEnemiesEndT1: readOptionalNumber('ctx-pryximite-end')
  };
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) scenario[key] = Math.max(0, value);
  }
  return scenario;
}

function fmt(value) {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(value || 0);
}

function renderResult(build, rank) {
  const itemRows = build.items.map((item) => {
    const fm = build.fm.assignments.find((entry) => entry.itemId === item.id);
    let fmText = '';
    if (fm?.type === 'critDamage') fmText = `+${fm.value} Do Crit`;
    if (fm?.type === 'spellDamagePct') fmText = `+${fm.value}% Do sorts`;
    const subtype = item.slotSubtype === 'prysmaradite' ? ' · Prysmaradite' : '';
    return `<li><span>${item.name}${subtype}</span><small>${fmText}</small></li>`;
  }).join('');

  return `
    <article class="result-card">
      <header><span class="rank">#${rank}</span><strong>${fmt(build.score)}</strong><small>score objectif</small></header>
      <div class="turns">
        <span>T1 <b>${fmt(build.perTurn[1])}</b></span>
        <span>T2 <b>${fmt(build.perTurn[2])}</b></span>
        <span>T3 <b>${fmt(build.perTurn[3])}</b></span>
      </div>
      <div class="stats-grid">
        <span>PA <b>${fmt(build.stats.ap)}</b></span><span>PM <b>${fmt(build.stats.mp)}</b></span>
        <span>PO <b>${fmt(build.stats.range)}</b></span><span>Vita <b>${fmt(build.stats.vit)}</b></span>
        <span>Terre <b>${fmt(build.stats.earth)}</b></span><span>Feu <b>${fmt(build.stats.fire)}</b></span>
        <span>Eau <b>${fmt(build.stats.water)}</b></span><span>Air <b>${fmt(build.stats.air)}</b></span>
        <span>Res T <b>${fmt(build.stats.resEarth)}%</b></span><span>Res F <b>${fmt(build.stats.resFire)}%</b></span>
        <span>Res E <b>${fmt(build.stats.resWater)}%</b></span><span>Res A <b>${fmt(build.stats.resAir)}%</b></span>
      </div>
      <details><summary>Équipement & FM</summary><ul class="gear-list">${itemRows}</ul></details>
      <details><summary>Caractéristiques automatiques</summary><pre>${JSON.stringify(build.characteristics, null, 2)}</pre></details>
    </article>
  `;
}

function setIdleState() {
  worker = null;
  optimizeButton.disabled = !dataset;
  optimizeButton.textContent = 'Optimiser le stuff';
}

function stopSolver() {
  if (!worker) return;
  worker.terminate();
  worker = null;
  activeRequestId++;
  diagnostics.textContent = 'Recherche arrêtée.';
  optimizeButton.textContent = 'Optimiser le stuff';
}

function handleWorkerMessage(event, requestId) {
  const message = event.data || {};
  if (message.requestId !== requestId || requestId !== activeRequestId) return;

  if (message.type === 'progress') {
    const progress = message.progress || {};
    diagnostics.textContent = `${Number(progress.nodes || 0).toLocaleString('fr-FR')} nœuds · ${Number(progress.pruned || 0).toLocaleString('fr-FR')} branches coupées · meilleur ${fmt(progress.best)}`;
    return;
  }

  if (message.type === 'error') {
    results.innerHTML = `<div class="empty">Erreur de calcul : ${message.message}</div>`;
    diagnostics.textContent = 'Le solveur a rencontré une erreur.';
    setIdleState();
    return;
  }

  if (message.type !== 'result') return;
  const output = message.output;
  results.innerHTML = output.results.length
    ? output.results.map((build, index) => renderResult(build, index + 1)).join('')
    : '<div class="empty">Aucun build certifié ne satisfait ces contraintes. Les passifs contextuels sans contexte renseigné sont volontairement écartés.</div>';
  diagnostics.textContent = `${output.diagnostics.visited.toLocaleString('fr-FR')} builds complets · ${output.diagnostics.nodes.toLocaleString('fr-FR')} nœuds · ${output.diagnostics.pruned.toLocaleString('fr-FR')} branches coupées`;
  setIdleState();
}

function runSolver() {
  if (worker) {
    stopSolver();
    return;
  }
  if (!dataset) return;

  const selections = readSelections();
  if (!selections.some((selection) => selection.enabled)) {
    results.innerHTML = '<div class="empty">Active au moins un sort à optimiser.</div>';
    return;
  }

  const requestId = ++activeRequestId;
  worker = new Worker(new URL('./optimizer-worker.js', import.meta.url), { type: 'module' });
  worker.addEventListener('message', (event) => handleWorkerMessage(event, requestId));
  worker.addEventListener('error', (event) => {
    if (requestId !== activeRequestId) return;
    results.innerHTML = `<div class="empty">Erreur du worker : ${event.message || 'inconnue'}</div>`;
    diagnostics.textContent = 'Le calcul a été interrompu.';
    setIdleState();
  });

  optimizeButton.textContent = 'Arrêter le calcul';
  results.innerHTML = '<div class="empty">Recherche exacte en cours sur la base certifiée…</div>';
  diagnostics.textContent = 'Préparation de l’espace de recherche…';

  worker.postMessage({
    type: 'optimize',
    requestId,
    payload: {
      items: dataset.items,
      sets: dataset.sets,
      selections,
      constraints: readConstraints(),
      fmPolicy: {
        spellDamagePct: readNumber('fm-spell'),
        allowCritDamage: $('#fm-crit').checked,
        critDamageAmount: 8
      },
      turnMode: $('#turn-mode').value,
      scenario: readScenario(),
      topN: 10
    }
  });
}

function initDefaults() {
  const map = {
    'min-ap': DEFAULT_CONSTRAINTS.ap,
    'min-mp': DEFAULT_CONSTRAINTS.mp,
    'min-range': DEFAULT_CONSTRAINTS.range,
    'min-vit': DEFAULT_CONSTRAINTS.vit,
    'res-earth': DEFAULT_CONSTRAINTS.resEarth,
    'res-fire': DEFAULT_CONSTRAINTS.resFire,
    'res-water': DEFAULT_CONSTRAINTS.resWater,
    'res-air': DEFAULT_CONSTRAINTS.resAir,
    'fm-spell': DEFAULT_FM.spellDamagePct
  };
  for (const [id, value] of Object.entries(map)) document.getElementById(id).value = value;
  $('#fm-crit').checked = DEFAULT_FM.allowCritDamage;
  $('#turn-mode').innerHTML = TURN_MODES.map(([value, label]) => `<option value="${value}">${label}</option>`).join('');
  $('#turn-mode').value = 'sum';
}

async function initData() {
  optimizeButton.disabled = true;
  $('#version').textContent = `V${APP_VERSION} · chargement…`;
  dataStatus.textContent = 'Chargement de la base certifiée…';
  try {
    dataset = await loadDofusData();
    const gameVersion = dataset.gameVersion?.version || 'inconnue';
    $('#version').textContent = `V${APP_VERSION} · Dofus ${gameVersion}`;
    dataStatus.textContent = `${dataset.items.length.toLocaleString('fr-FR')} équipements certifiés · ${dataset.sets.length.toLocaleString('fr-FR')} panoplies · calcul 100% local`;
    results.innerHTML = '<div class="empty">Base réelle chargée. Configure les contraintes puis lance l’optimisation.</div>';
    optimizeButton.disabled = false;
  } catch (error) {
    dataset = null;
    $('#version').textContent = `V${APP_VERSION} · données indisponibles`;
    dataStatus.textContent = error instanceof Error ? error.message : String(error);
    results.innerHTML = '<div class="empty">Impossible de charger la base certifiée.</div>';
    optimizeButton.disabled = true;
  }
}

renderSpellRows();
initDefaults();
optimizeButton.addEventListener('click', runSolver);
initData();
