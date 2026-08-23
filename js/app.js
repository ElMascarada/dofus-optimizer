import { APP_VERSION, DEFAULT_CONSTRAINTS, DEFAULT_FM, TURN_MODES } from './config.js';
import { loadDofusData, loadSpellData } from './data-loader.js';
import {
  castCap,
  requiredApByTurn,
  spellElementLabel,
  spellsForBreed
} from './spell-selection.js';

const $ = (selector) => document.querySelector(selector);
const spellList = $('#spell-list');
const results = $('#results');
const diagnostics = $('#diagnostics');
const optimizeButton = $('#optimize');
const dataStatus = $('#data-status');
const breedSelect = $('#breed-select');

let dataset = null;
let spellData = null;
let visibleSpells = [];
let worker = null;
let activeRequestId = 0;
let latestPartialResults = [];
let latestProgress = null;

function activeTurnsForMode(mode = $('#turn-mode')?.value || 'sum') {
  if (mode === 't1') return [1];
  if (mode === 't2') return [2];
  if (mode === 't3') return [3];
  return [1, 2, 3];
}

function syncTurnInputs() {
  const allowed = new Set(activeTurnsForMode());
  for (const row of document.querySelectorAll('.spell-row')) {
    for (const turn of [1, 2, 3]) {
      const input = row.querySelector(`.cast-t${turn}`);
      if (!input) continue;
      input.disabled = !allowed.has(turn);
    }
  }
}

function renderSpellRows() {
  if (!spellData || !breedSelect.value) {
    visibleSpells = [];
    spellList.innerHTML = '<div class="empty">Sélectionne une classe.</div>';
    return;
  }

  visibleSpells = spellsForBreed(spellData, breedSelect.value);
  spellList.innerHTML = visibleSpells.map((spell) => {
    const cap = castCap(spell);
    return `
      <div class="spell-row" data-spell-id="${spell.id}">
        <label class="check"><input type="checkbox" class="spell-enabled"> <span>${spell.name}</span></label>
        <div class="spell-facts"><span>${spell.apCost} PA</span><span>${spell.baseCritPct}% crit</span><span>${spellElementLabel(spell)}</span><span>PO ${spell.minRange}–${spell.maxRange}</span></div>
        <label>Poids <input class="spell-weight" type="number" min="0" step="0.1" value="1"></label>
        <label>T1 <input class="cast-t1" type="number" min="0" max="${cap}" value="1"></label>
        <label>T2 <input class="cast-t2" type="number" min="0" max="${cap}" value="1"></label>
        <label>T3 <input class="cast-t3" type="number" min="0" max="${cap}" value="1"></label>
      </div>
    `;
  }).join('') || '<div class="empty">Aucun sort offensif certifié pour cette classe.</div>';
  syncTurnInputs();
}

function readSelections() {
  const selections = [];
  const allowed = new Set(activeTurnsForMode());
  for (const row of document.querySelectorAll('.spell-row')) {
    const sourceSpell = visibleSpells.find((spell) => spell.id === row.dataset.spellId);
    if (!sourceSpell) continue;
    selections.push({
      spell: { ...sourceSpell },
      enabled: row.querySelector('.spell-enabled').checked,
      weight: Math.max(0, Number(row.querySelector('.spell-weight').value || 0)),
      casts: {
        1: allowed.has(1) ? Math.max(0, Number(row.querySelector('.cast-t1').value || 0)) : 0,
        2: allowed.has(2) ? Math.max(0, Number(row.querySelector('.cast-t2').value || 0)) : 0,
        3: allowed.has(3) ? Math.max(0, Number(row.querySelector('.cast-t3').value || 0)) : 0
      }
    });
  }
  return selections;
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
    if (fm?.type === 'exoAp') fmText = 'Exo +1 PA';
    if (fm?.type === 'exoMp') fmText = 'Exo +1 PM';
    const subtype = item.slotSubtype === 'prysmaradite' ? ' · Prysmaradite' : '';
    return `<li><span>${item.name}${subtype}</span><small>${fmText}</small></li>`;
  }).join('');

  const turnRows = activeTurnsForMode()
    .map((turn) => `<span>T${turn} <b>${fmt(build.perTurn?.[turn])}</b></span>`)
    .join('');

  return `
    <article class="result-card">
      <header><span class="rank">#${rank}</span><strong>${fmt(build.score)}</strong><small>score objectif</small></header>
      <div class="turns">${turnRows}</div>
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

function renderBuilds(builds, emptyText) {
  results.innerHTML = builds.length
    ? builds.map((build, index) => renderResult(build, index + 1)).join('')
    : `<div class="empty">${emptyText}</div>`;
}

function setIdleState() {
  const finishedWorker = worker;
  worker = null;
  if (finishedWorker) finishedWorker.terminate();
  optimizeButton.disabled = !(dataset && spellData);
  optimizeButton.textContent = 'Optimiser le stuff';
}

function stopSolver() {
  if (!worker) return;
  worker.terminate();
  worker = null;
  activeRequestId++;
  optimizeButton.textContent = 'Optimiser le stuff';

  if (latestPartialResults.length) {
    renderBuilds(latestPartialResults, 'Aucun stuff trouvé avant l’arrêt.');
    const nodes = Number(latestProgress?.nodes || 0).toLocaleString('fr-FR');
    diagnostics.textContent = `Recherche arrêtée · ${latestPartialResults.length} meilleur${latestPartialResults.length > 1 ? 's' : ''} stuff${latestPartialResults.length > 1 ? 's' : ''} conservé${latestPartialResults.length > 1 ? 's' : ''} · ${nodes} nœuds parcourus`;
  } else {
    diagnostics.textContent = 'Recherche arrêtée avant qu’un stuff valide ne soit trouvé.';
    results.innerHTML = '<div class="empty">Aucun stuff valide trouvé avant l’arrêt.</div>';
  }
}

function handleWorkerMessage(event, requestId) {
  const message = event.data || {};
  if (message.requestId !== requestId || requestId !== activeRequestId) return;

  if (message.type === 'progress') {
    const progress = message.progress || {};
    latestProgress = progress;
    if (Array.isArray(progress.partialResults) && progress.partialResults.length) {
      latestPartialResults = progress.partialResults;
    }
    const seedLabel = progress.seeded ? 'base panoplies · ' : '';
    diagnostics.textContent = `${seedLabel}${Number(progress.nodes || 0).toLocaleString('fr-FR')} nœuds · ${Number(progress.pruned || 0).toLocaleString('fr-FR')} branches coupées · meilleur ${fmt(progress.best)}`;
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
  latestPartialResults = output.results || [];
  renderBuilds(output.results, 'Aucun build certifié ne satisfait ces contraintes et ce combo de sorts.');
  diagnostics.textContent = `${output.diagnostics.visited.toLocaleString('fr-FR')} builds complets · ${output.diagnostics.nodes.toLocaleString('fr-FR')} nœuds · ${output.diagnostics.pruned.toLocaleString('fr-FR')} branches coupées`;
  setIdleState();
}

function runSolver() {
  if (worker) {
    stopSolver();
    return;
  }
  if (!dataset || !spellData) return;

  const selections = readSelections();
  if (!selections.some((selection) => selection.enabled)) {
    results.innerHTML = '<div class="empty">Active au moins un sort à optimiser.</div>';
    return;
  }

  const constraints = readConstraints();
  const scenario = readScenario();
  scenario.requiredApByTurn = requiredApByTurn(selections);
  const requestId = ++activeRequestId;
  latestPartialResults = [];
  latestProgress = null;
  worker = new Worker(new URL('./optimizer-worker.js', import.meta.url), { type: 'module' });
  worker.addEventListener('message', (event) => handleWorkerMessage(event, requestId));
  worker.addEventListener('error', (event) => {
    if (requestId !== activeRequestId) return;
    results.innerHTML = `<div class="empty">Erreur du worker : ${event.message || 'inconnue'}</div>`;
    diagnostics.textContent = 'Le calcul a été interrompu.';
    setIdleState();
  });

  const ap = scenario.requiredApByTurn;
  const comboText = activeTurnsForMode().map((turn) => `${ap[turn]} PA T${turn}`).join(' · ');
  optimizeButton.textContent = 'Arrêter le calcul';
  results.innerHTML = '<div class="empty">Recherche en cours : bases de panoplies puis optimisation exacte…</div>';
  diagnostics.textContent = `Combo demandé : ${comboText}`;

  worker.postMessage({
    type: 'optimize',
    requestId,
    payload: {
      items: dataset.items,
      sets: dataset.sets,
      selections,
      constraints,
      fmPolicy: {
        spellDamagePct: readNumber('fm-spell'),
        allowCritDamage: $('#fm-crit').checked,
        critDamageAmount: 8,
        structuralExos: true
      },
      turnMode: $('#turn-mode').value,
      scenario,
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
  $('#turn-mode').addEventListener('change', syncTurnInputs);
}

function initBreedSelect() {
  breedSelect.innerHTML = spellData.breeds.map((breed) => `<option value="${breed.id}">${breed.name} · ${breed.spellIds.length} sorts</option>`).join('');
  breedSelect.disabled = false;
  breedSelect.addEventListener('change', () => {
    if (worker) stopSolver();
    renderSpellRows();
    results.innerHTML = '<div class="empty">Sélectionne un ou plusieurs sorts puis lance l’optimisation.</div>';
    diagnostics.textContent = '';
  });
  renderSpellRows();
}

async function initData() {
  optimizeButton.disabled = true;
  breedSelect.disabled = true;
  $('#version').textContent = `V${APP_VERSION} · chargement…`;
  dataStatus.textContent = 'Chargement des équipements et sorts certifiés…';
  try {
    [dataset, spellData] = await Promise.all([loadDofusData(), loadSpellData()]);
    const equipmentVersion = dataset.gameVersion?.version || 'inconnue';
    const spellVersion = spellData.gameVersion?.version || 'inconnue';
    if (equipmentVersion !== spellVersion) throw new Error(`Versions de données incohérentes : équipements ${equipmentVersion}, sorts ${spellVersion}.`);
    $('#version').textContent = `V${APP_VERSION} · Dofus ${equipmentVersion}`;
    dataStatus.textContent = `${dataset.items.length.toLocaleString('fr-FR')} équipements · ${dataset.sets.length.toLocaleString('fr-FR')} panoplies · ${spellData.spells.length.toLocaleString('fr-FR')} sorts offensifs certifiés · calcul 100% local`;
    initBreedSelect();
    results.innerHTML = '<div class="empty">Bases réelles chargées. Choisis ta classe et tes sorts.</div>';
    optimizeButton.disabled = false;
  } catch (error) {
    dataset = null;
    spellData = null;
    $('#version').textContent = `V${APP_VERSION} · données indisponibles`;
    dataStatus.textContent = error instanceof Error ? error.message : String(error);
    spellList.innerHTML = '<div class="empty">Impossible de charger le catalogue certifié.</div>';
    results.innerHTML = '<div class="empty">Impossible de charger les bases certifiées.</div>';
    optimizeButton.disabled = true;
    breedSelect.disabled = true;
  }
}

initDefaults();
optimizeButton.addEventListener('click', runSolver);
initData();
