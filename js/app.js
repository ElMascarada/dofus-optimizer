import { APP_VERSION, DEFAULT_CONSTRAINTS, DEFAULT_FM, SLOT_RULES, TURN_MODES } from './config.js';
import { SAMPLE_SPELLS } from './sample-data.js';

const $ = (selector) => document.querySelector(selector);
const spellList = $('#spell-list');
const results = $('#results');
const diagnostics = $('#diagnostics');
const optimizeButton = $('#optimize');
const slotOrder = Object.fromEntries(SLOT_RULES.map((rule, index) => [rule.id, index]));

let worker = null;
let workerReady = false;
let running = false;
let requestId = 0;
let datasetSummary = null;

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function renderSpellRows() {
  spellList.innerHTML = SAMPLE_SPELLS.map((spell, index) => `
    <div class="spell-row" data-spell-id="${escapeHtml(spell.id)}">
      <label class="check"><input type="checkbox" class="spell-enabled" ${index < 2 ? 'checked' : ''}> <span>${escapeHtml(spell.name)}</span></label>
      <label>Poids <input class="spell-weight" type="number" min="0" step="0.1" value="${index === 0 ? 1 : 0.7}"></label>
      <label>T1 <input class="cast-t1" type="number" min="0" max="6" value="1"></label>
      <label>T2 <input class="cast-t2" type="number" min="0" max="6" value="1"></label>
      <label>T3 <input class="cast-t3" type="number" min="0" max="6" value="1"></label>
    </div>
  `).join('');
}

function readSelections() {
  return [...document.querySelectorAll('.spell-row')].map((row) => {
    const spell = SAMPLE_SPELLS.find((entry) => entry.id === row.dataset.spellId);
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

function readBool(id) {
  return document.getElementById(id).value === 'true';
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
  const turns = {};
  for (const turn of [1, 2, 3]) {
    turns[turn] = {
      attackedSinceLastTurn: readBool(`attacked-t${turn}`),
      enemyAdjacent: readBool(`adjacent-t${turn}`),
      hpPct: Math.max(0, Math.min(100, readNumber(`hp-t${turn}`))),
      pourpreStacks: Math.max(0, Math.min(10, readNumber(`pourpre-t${turn}`))),
      turquoiseStacks: Math.max(0, Math.min(10, readNumber(`turquoise-t${turn}`)))
    };
  }
  return { turns };
}

function fmt(value) {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(value || 0);
}

function fmLabel(assignment) {
  if (!assignment || assignment.type === 'none') return 'sans FM offensive';
  if (assignment.type === 'critDamage') return `+${assignment.value} Do Crit`;
  if (assignment.type === 'spellDamagePct') return `+${assignment.value}% Do sorts`;
  return assignment.type;
}

function renderGearItem(item, assignment) {
  const passives = (item.passives || []).map((passive) => escapeHtml(passive.label || passive.id)).join(' · ');
  const meta = [`niv. ${item.level}`, item.typeName].filter(Boolean).map(escapeHtml).join(' · ');
  const image = item.imageUrl
    ? `<img class="item-icon" src="${escapeHtml(item.imageUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
    : '<span class="item-icon placeholder"></span>';
  return `
    <li class="gear-item">
      ${image}
      <span class="gear-copy"><b>${escapeHtml(item.name)}</b><small>${meta}</small>${passives ? `<em>${passives}</em>` : ''}</span>
      <span class="fm-badge">${escapeHtml(fmLabel(assignment))}</span>
    </li>`;
}

function renderResult(build, rank) {
  const assignments = new Map((build.fm?.assignments || []).map((entry) => [entry.itemId, entry]));
  const orderedItems = [...build.items].sort((a, b) => (slotOrder[a.slot] ?? 99) - (slotOrder[b.slot] ?? 99) || a.name.localeCompare(b.name));
  const itemRows = orderedItems.map((item) => renderGearItem(item, assignments.get(item.id))).join('');
  const setText = (build.activeSets || []).length
    ? `<div class="set-list">${build.activeSets.map((set) => `<span>${escapeHtml(set.name)} ×${set.count}</span>`).join('')}</div>`
    : '<p class="hint">Aucun bonus de panoplie actif.</p>';

  return `
    <article class="result-card">
      <header><span class="rank">#${rank}</span><strong>${fmt(build.score)}</strong><small>score objectif</small></header>
      <div class="turns">
        <span>T1 <b>${fmt(build.perTurn?.[1])}</b></span>
        <span>T2 <b>${fmt(build.perTurn?.[2])}</b></span>
        <span>T3 <b>${fmt(build.perTurn?.[3])}</b></span>
      </div>
      <div class="stats-grid">
        <span>PA <b>${fmt(build.stats.ap)}</b></span><span>PM <b>${fmt(build.stats.mp)}</b></span>
        <span>Puissance <b>${fmt(build.stats.power)}</b></span><span>Crit <b>${fmt(build.stats.crit)}%</b></span><span>Do Crit <b>${fmt(build.stats.critDamage)}</b></span>
        <span>Terre <b>${fmt(build.stats.earth)}</b></span><span>Feu <b>${fmt(build.stats.fire)}</b></span>
        <span>Eau <b>${fmt(build.stats.water)}</b></span><span>Air <b>${fmt(build.stats.air)}</b></span><span>Do sorts <b>${fmt(build.stats.spellDamagePct)}%</b></span>
        <span>Res T <b>${fmt(build.stats.resEarth)}%</b></span><span>Res F <b>${fmt(build.stats.resFire)}%</b></span>
        <span>Res E <b>${fmt(build.stats.resWater)}%</b></span><span>Res A <b>${fmt(build.stats.resAir)}%</b></span>
      </div>
      <details open><summary>Équipement & FM</summary><ul class="gear-list">${itemRows}</ul></details>
      <details><summary>Panoplies</summary>${setText}</details>
      <details><summary>Caractéristiques automatiques</summary><pre>${escapeHtml(JSON.stringify(build.characteristics, null, 2))}</pre></details>
    </article>
  `;
}

function updateDatasetSummary(summary) {
  datasetSummary = summary;
  $('#version').textContent = `V${APP_VERSION} · Dofus ${summary.gameVersion}`;
  $('#dataset-status').textContent = 'Snapshot prêt';
  $('#dataset-status').classList.add('ready');
  const classicCount = ['hat', 'cape', 'amulet', 'ring', 'belt', 'boots', 'weapon', 'shield']
    .reduce((sum, slot) => sum + Number(summary.bySlot?.[slot] || 0), 0);
  $('#dataset-summary').textContent = `${summary.itemCount.toLocaleString('fr-FR')} objets certifiés · ${summary.setCount} panoplies · ${classicCount.toLocaleString('fr-FR')} équipements classiques niv. 190–200 + Dofus/trophées/familiers/montures.`;
}

function renderDiagnostics(output) {
  const d = output.diagnostics || {};
  const candidateRemoved = (d.groups || []).reduce((sum, group) => sum + Number(group.removed || 0), 0);
  diagnostics.textContent = `${Number(d.nodes || 0).toLocaleString('fr-FR')} nœuds · ${Number(d.visited || 0).toLocaleString('fr-FR')} builds complets · ${Number(d.pruned || 0).toLocaleString('fr-FR')} branches coupées · ${candidateRemoved.toLocaleString('fr-FR')} candidats dominés/équivalents retirés${d.rejectedUnresolvedPassives ? ` · ${d.rejectedUnresolvedPassives} contextes passifs rejetés` : ''}`;
}

function setIdleButton() {
  running = false;
  optimizeButton.disabled = !workerReady;
  optimizeButton.textContent = workerReady ? 'Optimiser le stuff' : 'Chargement des données…';
}

function handleWorkerMessage(event) {
  const message = event.data || {};
  if (message.type === 'ready') {
    workerReady = true;
    updateDatasetSummary(message.summary);
    setIdleButton();
    return;
  }
  if (message.requestId != null && message.requestId !== requestId) return;

  if (message.type === 'progress') {
    const progress = message.progress || {};
    diagnostics.textContent = `${Number(progress.nodes || 0).toLocaleString('fr-FR')} nœuds explorés · ${Number(progress.pruned || 0).toLocaleString('fr-FR')} branches coupées · meilleur score ${fmt(progress.best)}`;
    return;
  }
  if (message.type === 'result') {
    const output = message.output;
    results.innerHTML = output.results.length
      ? output.results.map((build, index) => renderResult(build, index + 1)).join('')
      : '<div class="empty">Aucun build certifié ne satisfait ces contraintes et ces hypothèses de passifs.</div>';
    renderDiagnostics(output);
    setIdleButton();
    return;
  }
  if (message.type === 'error') {
    results.innerHTML = `<div class="empty error">${escapeHtml(message.message || 'Erreur inconnue')}</div>`;
    diagnostics.textContent = 'Le calcul a été interrompu par une erreur.';
    setIdleButton();
  }
}

function createWorker() {
  worker?.terminate();
  workerReady = false;
  worker = new Worker(new URL('./solver-worker.js', import.meta.url), { type: 'module' });
  worker.addEventListener('message', handleWorkerMessage);
  worker.addEventListener('error', (event) => {
    results.innerHTML = `<div class="empty error">Worker: ${escapeHtml(event.message || 'erreur inconnue')}</div>`;
    setIdleButton();
  });
}

function cancelSearch() {
  requestId++;
  running = false;
  results.innerHTML = '<div class="empty">Calcul annulé. Le moteur est réinitialisé.</div>';
  diagnostics.textContent = '';
  createWorker();
  optimizeButton.textContent = 'Chargement des données…';
  optimizeButton.disabled = true;
}

function runSolver() {
  if (running) {
    cancelSearch();
    return;
  }
  if (!workerReady) return;
  if (!readSelections().some((selection) => selection.enabled && selection.weight > 0)) {
    results.innerHTML = '<div class="empty error">Sélectionne au moins un sort avec un poids supérieur à 0.</div>';
    return;
  }

  running = true;
  requestId++;
  optimizeButton.disabled = false;
  optimizeButton.textContent = 'Annuler le calcul';
  results.innerHTML = '<div class="empty working"><span class="spinner"></span>Recherche exacte dans le snapshot réel…</div>';
  diagnostics.textContent = 'Préparation de l’espace de recherche…';

  worker.postMessage({
    type: 'optimize',
    requestId,
    payload: {
      selections: readSelections(),
      constraints: readConstraints(),
      fmPolicy: {
        spellDamagePct: readNumber('fm-spell'),
        allowCritDamage: $('#fm-crit').checked,
        critDamageAmount: 8
      },
      scenario: readScenario(),
      turnMode: $('#turn-mode').value,
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

renderSpellRows();
initDefaults();
optimizeButton.addEventListener('click', runSolver);
createWorker();
