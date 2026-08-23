import { APP_VERSION, DEFAULT_CONSTRAINTS, DEFAULT_FM, TURN_MODES } from './config.js';
import { optimizeBuild } from './solver.js';
import { SAMPLE_ITEMS, SAMPLE_SETS, SAMPLE_SPELLS } from './sample-data.js';

const $ = (selector) => document.querySelector(selector);
const spellList = $('#spell-list');
const results = $('#results');
const diagnostics = $('#diagnostics');

$('#version').textContent = `V${APP_VERSION} · dataset démo`;

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

function fmt(value) {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(value || 0);
}

function renderResult(build, rank) {
  const itemRows = build.items.map((item) => {
    const fm = build.fm.assignments.find((entry) => entry.itemId === item.id);
    const fmText = fm?.type === 'critDamage' ? `+${fm.value} Do Crit` : `+${fm?.value || 0}% Do sorts`;
    return `<li><span>${item.name}</span><small>${fmText}</small></li>`;
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

function runSolver() {
  const button = $('#optimize');
  button.disabled = true;
  button.textContent = 'Calcul…';
  results.innerHTML = '<div class="empty">Recherche en cours…</div>';

  setTimeout(() => {
    const output = optimizeBuild({
      items: SAMPLE_ITEMS,
      sets: SAMPLE_SETS,
      selections: readSelections(),
      constraints: readConstraints(),
      fmPolicy: {
        spellDamagePct: readNumber('fm-spell'),
        allowCritDamage: $('#fm-crit').checked,
        critDamageAmount: 8
      },
      turnMode: $('#turn-mode').value,
      topN: 10
    });

    results.innerHTML = output.results.length
      ? output.results.map((build, index) => renderResult(build, index + 1)).join('')
      : '<div class="empty">Aucun build ne satisfait ces contraintes avec le dataset de démonstration.</div>';
    diagnostics.textContent = `${output.diagnostics.visited.toLocaleString('fr-FR')} builds complets · ${output.diagnostics.pruned.toLocaleString('fr-FR')} branches coupées`;
    button.disabled = false;
    button.textContent = 'Optimiser le stuff';
  }, 20);
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
$('#optimize').addEventListener('click', runSolver);
runSolver();
