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

const SLOT_ORDER = ['hat', 'cape', 'amulet', 'ring', 'belt', 'boots', 'weapon', 'shield', 'companion', 'dofus'];
const SLOT_LABELS = {
  hat: 'Coiffe', cape: 'Cape', amulet: 'Amulette', ring: 'Anneau', belt: 'Ceinture',
  boots: 'Bottes', weapon: 'Arme', shield: 'Bouclier', companion: 'Familier / monture', dofus: 'Dofus / trophée'
};
const STAT_LABELS = {
  ap: 'PA', mp: 'PM', range: 'PO', vit: 'Vitalité', power: 'Puissance', crit: 'Critiques',
  earth: 'Terre', fire: 'Feu', water: 'Eau', air: 'Air', wisdom: 'Sagesse', summons: 'Invocations',
  damage: 'Dommages', damageNeutral: 'Do Neutre', damageEarth: 'Do Terre', damageFire: 'Do Feu',
  damageWater: 'Do Eau', damageAir: 'Do Air', critDamage: 'Do Crit', spellDamagePct: '% Do sorts',
  weaponDamagePct: '% Do armes', pushbackDamage: 'Do poussée', trapDamage: 'Do pièges', trapPower: 'Puissance pièges',
  resNeutral: 'Res Neutre', resEarth: 'Res Terre', resFire: 'Res Feu', resWater: 'Res Eau', resAir: 'Res Air',
  fixedResNeutral: 'Res fixe Neutre', fixedResEarth: 'Res fixe Terre', fixedResFire: 'Res fixe Feu',
  fixedResWater: 'Res fixe Eau', fixedResAir: 'Res fixe Air', critResistance: 'Res Crit',
  pushbackResistance: 'Res poussée', lock: 'Tacle', dodge: 'Fuite', apReduction: 'Retrait PA',
  mpReduction: 'Retrait PM', apParry: 'Esquive PA', mpParry: 'Esquive PM', heals: 'Soins',
  initiative: 'Initiative', prospecting: 'Prospection', pods: 'Pods'
};

let dataset = null;
let spellData = null;
let visibleSpells = [];
let worker = null;
let activeRequestId = 0;
let latestPartialResults = [];
let latestProgress = null;
let displayedBuilds = [];
let modalReady = false;

function isCombatMode() {
  return $('#objective-mode')?.value === 'combat';
}

function activeTurnsForMode(mode = $('#turn-mode')?.value || 'sum') {
  if (isCombatMode()) {
    const count = Math.max(1, Math.min(3, Number($('#combat-turns')?.value || 1)));
    return [1, 2, 3].slice(0, count);
  }
  if (mode === 't1') return [1];
  if (mode === 't2') return [2];
  if (mode === 't3') return [3];
  return [1, 2, 3];
}

function displayTurnsForBuild(build) {
  const count = Number(build?.combatPlan?.objective?.turns || 0);
  if (count > 0) return [1, 2, 3].slice(0, Math.min(3, count));
  return activeTurnsForMode();
}

function syncTurnInputs() {
  const allowed = new Set(activeTurnsForMode());
  const combat = isCombatMode();
  for (const row of document.querySelectorAll('.spell-row')) {
    const checkbox = row.querySelector('.spell-enabled');
    const weight = row.querySelector('.spell-weight');
    if (checkbox) checkbox.disabled = combat;
    if (weight) weight.disabled = combat;
    for (const turn of [1, 2, 3]) {
      const input = row.querySelector(`.cast-t${turn}`);
      if (!input) continue;
      input.disabled = combat || !allowed.has(turn);
    }
  }
}

function syncObjectiveControls() {
  const combat = isCombatMode();
  const manual = $('#manual-objective-controls');
  const automatic = $('#combat-objective-controls');
  if (manual) manual.hidden = combat;
  if (automatic) automatic.hidden = !combat;
  const zone = $('#combat-target-mode')?.value === 'zone';
  if ($('#combat-area-targets')) $('#combat-area-targets').disabled = !zone;
  syncTurnInputs();
}

function renderSpellRows() {
  if (!spellData || !breedSelect.value) {
    visibleSpells = [];
    spellList.innerHTML = '<div class="empty">Sélectionne une classe.</div>';
    return;
  }

  // Manual mode only exposes direct damaging spells. Support-only spells remain
  // in the class catalog and are consumed automatically by combat mode.
  visibleSpells = spellsForBreed(spellData, breedSelect.value).filter((spell) => (spell.hits || []).length > 0);
  spellList.innerHTML = visibleSpells.map((spell) => {
    const cap = castCap(spell);
    const variant = spell.isVariant ? '<span class="spell-variant-badge">Variante</span>' : '';
    return `
      <div class="spell-row" data-spell-id="${spell.id}">
        <label class="check"><input type="checkbox" class="spell-enabled"> <span>${escapeHtml(spell.name)}</span>${variant}</label>
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

function readCombatObjective() {
  return {
    targetMode: $('#combat-target-mode')?.value === 'zone' ? 'zone' : 'single',
    areaTargets: Math.max(2, Number($('#combat-area-targets')?.value || 3)),
    turns: Math.max(1, Math.min(3, Number($('#combat-turns')?.value || 1))),
    allowSupport: Boolean($('#combat-allow-support')?.checked),
    metric: $('#combat-metric')?.value === 'damage-per-ap' ? 'damage-per-ap' : 'total-damage'
  };
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
    ap: readNumber('min-ap'), mp: readNumber('min-mp'), range: readNumber('min-range'), vit: readNumber('min-vit'),
    resEarth: readNumber('res-earth'), resFire: readNumber('res-fire'), resWater: readNumber('res-water'), resAir: readNumber('res-air')
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

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

function fmTextFor(build, item) {
  const fm = build.fm?.assignments?.find((entry) => entry.itemId === item.id);
  if (fm?.type === 'critDamage') return `+${fm.value} Do Crit`;
  if (fm?.type === 'spellDamagePct') return `+${fm.value}% Do sorts`;
  if (fm?.type === 'exoAp') return 'Exo +1 PA';
  if (fm?.type === 'exoMp') return 'Exo +1 PM';
  return '';
}

function renderResult(build, rank, index) {
  const itemRows = build.items.map((item) => {
    const subtype = item.slotSubtype === 'prysmaradite' ? ' · Prysmaradite' : '';
    return `<li><span>${escapeHtml(item.name)}${subtype}</span><small>${fmTextFor(build, item)}</small></li>`;
  }).join('');
  const turnRows = displayTurnsForBuild(build).map((turn) => `<span>T${turn} <b>${fmt(build.perTurn?.[turn])}</b></span>`).join('');
  const scoreLabel = build.combatPlan ? 'meilleur tour' : 'score objectif';

  return `
    <article class="result-card" data-build-index="${index}" tabindex="0" aria-label="Ouvrir la fiche détaillée du stuff numéro ${rank}">
      <header><span class="rank">#${rank}</span><strong>${fmt(build.score)}</strong><small>${scoreLabel}</small></header>
      <div class="turns">${turnRows}</div>
      <div class="stats-grid">
        <span>PA <b>${fmt(build.stats.ap)}</b></span><span>PM <b>${fmt(build.stats.mp)}</b></span>
        <span>PO <b>${fmt(build.stats.range)}</b></span><span>Vita <b>${fmt(build.stats.vit)}</b></span>
        <span>Puissance <b>${fmt(build.stats.power)}</b></span><span>Crit <b>${fmt(build.stats.crit)}%</b></span>
        <span>Terre <b>${fmt(build.stats.earth)}</b></span><span>Feu <b>${fmt(build.stats.fire)}</b></span>
        <span>Eau <b>${fmt(build.stats.water)}</b></span><span>Air <b>${fmt(build.stats.air)}</b></span>
        <span>Do Crit <b>${fmt(build.stats.critDamage)}</b></span><span>Do fixes <b>${fmt(build.stats.damage)}</b></span>
        <span>Res T <b>${fmt(build.stats.resEarth)}%</b></span><span>Res F <b>${fmt(build.stats.resFire)}%</b></span>
        <span>Res E <b>${fmt(build.stats.resWater)}%</b></span><span>Res A <b>${fmt(build.stats.resAir)}%</b></span>
      </div>
      <div class="card-open-hint">Cliquer pour ouvrir la fiche complète</div>
      <details><summary>Équipement & FM</summary><ul class="gear-list">${itemRows}</ul></details>
      <details><summary>Caractéristiques automatiques</summary><pre>${JSON.stringify(build.characteristics, null, 2)}</pre></details>
    </article>
  `;
}

function statTile(build, key, suffix = '') {
  return `<div class="detail-stat"><span>${STAT_LABELS[key] || key}</span><b>${fmt(build.stats?.[key])}${suffix}</b></div>`;
}

function statSection(build, title, entries) {
  const tiles = entries.map(([key, suffix = '']) => statTile(build, key, suffix)).join('');
  return `<section class="detail-section"><h3>${title}</h3><div class="detail-stat-grid">${tiles}</div></section>`;
}

function renderSetBonusStats(bonus = {}) {
  const entries = Object.entries(bonus).filter(([, value]) => Number(value || 0) !== 0);
  if (!entries.length) return '<span class="muted">Aucun bonus chiffré</span>';
  return entries.map(([key, value]) => `<span class="set-bonus-chip">${STAT_LABELS[key] || key} <b>${fmt(value)}${key.startsWith('res') || key.endsWith('Pct') ? '%' : ''}</b></span>`).join('');
}

function renderDetailedEquipment(build) {
  const slotRank = new Map(SLOT_ORDER.map((slot, index) => [slot, index]));
  const ordered = [...build.items].sort((a, b) => (slotRank.get(a.slot) ?? 99) - (slotRank.get(b.slot) ?? 99));
  return ordered.map((item) => {
    const image = item.imageUrl ? `<img src="${escapeHtml(item.imageUrl)}" alt="" loading="lazy">` : '<div class="gear-placeholder"></div>';
    const subtype = item.slotSubtype === 'prysmaradite' ? ' · Prysmaradite' : '';
    return `
      <div class="detail-gear-row">
        ${image}
        <div><small>${SLOT_LABELS[item.slot] || item.slot}</small><strong>${escapeHtml(item.name)}${subtype}</strong></div>
        <em>${fmTextFor(build, item)}</em>
      </div>
    `;
  }).join('');
}

function renderActiveSets(build) {
  if (!build.activeSets?.length) return '<div class="detail-empty">Aucun bonus de panoplie actif.</div>';
  return build.activeSets.map((set) => `
    <div class="set-card">
      <header><strong>${escapeHtml(set.name || set.setId)}</strong><span>${set.count} items</span></header>
      <div class="set-bonus-list">${renderSetBonusStats(set.bonus)}</div>
    </div>
  `).join('');
}

function spellIconUrl(spell) {
  const iconId = Number(spell?.iconId || 0);
  if (!iconId) return '';
  return `https://api.dofusdu.de/dofus3/v1/img/spell/${iconId}-96.png`;
}

function renderSpellTurnChips(spell) {
  return [1, 2, 3].map((turn) => {
    const entry = spell.perTurn?.[turn];
    return `<span class="spell-turn-chip"><small>T${turn}</small><b>${fmt(entry?.expected)}</b></span>`;
  }).join('');
}

function renderSpellDamageCards(build) {
  const spells = Array.isArray(build.spellBreakdowns) ? build.spellBreakdowns : [];
  if (!spells.length) return '';
  const cards = spells.map((spell) => {
    const iconUrl = spellIconUrl(spell);
    const icon = iconUrl
      ? `<span class="spell-damage-icon"><img src="${escapeHtml(iconUrl)}" alt="" loading="lazy"><span>✦</span></span>`
      : '<span class="spell-damage-icon"><span>✦</span></span>';
    const perTurnDetails = [1, 2, 3].map((turn) => {
      const entry = spell.perTurn?.[turn] || {};
      return `<div class="spell-turn-detail"><strong>T${turn}</strong><span>Moy. ${fmt(entry.expected)}</span><span>Normal ${fmt(entry.normal?.[0])}–${fmt(entry.normal?.[1])}</span><span>Crit ${fmt(entry.critical?.[0])}–${fmt(entry.critical?.[1])}</span><span>${fmt(entry.critChancePct)}% crit</span></div>`;
    }).join('');
    return `
      <details class="spell-damage-card">
        <summary>
          ${icon}
          <span class="spell-damage-meta"><strong>${escapeHtml(spell.name)}</strong><small>${fmt(spell.apCost)} PA · moyenne globale T1–T3</small></span>
          <span class="spell-turn-chips">${renderSpellTurnChips(spell)}</span>
          <b class="spell-damage-average">${fmt(spell.averageDamage)}</b>
        </summary>
        <div class="spell-damage-expanded">
          <div><span>Plage normale moyenne</span><b>${fmt(spell.normal?.[0])} – ${fmt(spell.normal?.[1])}</b></div>
          <div><span>Plage critique moyenne</span><b>${fmt(spell.critical?.[0])} – ${fmt(spell.critical?.[1])}</b></div>
          <div><span>Chance de critique moyenne</span><b>${fmt(spell.critChancePct)}%</b></div>
          <div class="spell-turn-details">${perTurnDetails}</div>
        </div>
      </details>
    `;
  }).join('');
  return `
    <section class="detail-section spell-damage-section">
      <div class="spell-damage-heading"><div><h3>Dégâts moyens par sort</h3><p>Moyenne globale puis moyenne T1/T2/T3 pour visualiser les effets temporels comme le Nébuleux.</p></div><small>Cliquer sur un sort pour détailler</small></div>
      <div class="spell-damage-list">${cards}</div>
    </section>
  `;
}

function renderCombatPlan(build) {
  const plan = build?.combatPlan;
  if (!plan?.sequence?.length) return '';
  const turns = [];
  for (let turn = 1; turn <= Number(plan.objective?.turns || 1); turn++) {
    const entries = plan.sequence.filter((entry) => Number(entry.turn) === turn);
    const rows = entries.map((entry, index) => {
      const iconUrl = spellIconUrl(entry);
      const icon = iconUrl ? `<img src="${escapeHtml(iconUrl)}" alt="" loading="lazy">` : '<span>✦</span>';
      const buff = entry.appliedModifiers?.length ? '<small class="combat-buff-tag">buff/debuff appliqué</small>' : '';
      return `<div class="combat-sequence-row"><span class="combat-order">${index + 1}</span><span class="combat-sequence-icon">${icon}</span><strong>${escapeHtml(entry.name)}</strong><span>${fmt(entry.apCost)} PA</span><b>${fmt(entry.expectedDamage)}</b>${buff}</div>`;
    }).join('') || '<div class="detail-empty">Aucun sort.</div>';
    turns.push(`<div class="combat-turn-block"><header><strong>T${turn}</strong><span>${fmt(plan.perTurn?.[turn])} dégâts</span></header>${rows}</div>`);
  }
  const target = plan.objective?.targetMode === 'zone' ? `Zone · ${plan.objective.areaTargets} cibles` : '1 cible';
  return `
    <section class="detail-section combat-plan-section">
      <div class="spell-damage-heading"><div><h3>Meilleure séquence trouvée</h3><p>${target} · ${plan.objective.turns} tour${plan.objective.turns > 1 ? 's' : ''} · dégâts moyens</p></div><b>${fmt(plan.totalDamage)}</b></div>
      <div class="combat-turn-list">${turns.join('')}</div>
    </section>
  `;
}

function ensureBuildModal() {
  if (modalReady) return;
  document.body.insertAdjacentHTML('beforeend', `
    <div id="build-modal" class="build-modal" aria-hidden="true">
      <div class="build-modal-backdrop" data-close-modal></div>
      <div class="build-modal-panel" role="dialog" aria-modal="true" aria-labelledby="build-modal-title">
        <button class="build-modal-close" type="button" data-close-modal aria-label="Fermer">×</button>
        <div id="build-modal-content"></div>
      </div>
    </div>
  `);
  const modal = $('#build-modal');
  modal.addEventListener('click', (event) => {
    if (event.target.closest('[data-close-modal]')) closeBuildModal();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && modal.classList.contains('is-open')) closeBuildModal();
  });
  modalReady = true;
}

function closeBuildModal() {
  const modal = $('#build-modal');
  if (!modal) return;
  modal.classList.remove('is-open');
  modal.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('modal-open');
}

function openBuildModal(build, rank) {
  if (!build) return;
  ensureBuildModal();
  const turns = displayTurnsForBuild(build).map((turn) => `<div><span>T${turn}</span><b>${fmt(build.perTurn?.[turn])}</b></div>`).join('');
  const warnings = build.warnings?.length
    ? `<div class="detail-warning">Hypothèses / avertissements : ${build.warnings.map(escapeHtml).join(' · ')}</div>`
    : '';

  $('#build-modal-content').innerHTML = `
    <header class="detail-header">
      <div><span class="rank">#${rank}</span><h2 id="build-modal-title">Fiche complète du stuff</h2></div>
      <div class="detail-score"><b>${fmt(build.score)}</b><span>${build.combatPlan ? 'meilleur tour' : 'score objectif'}</span></div>
    </header>
    <div class="detail-turns">${turns}</div>
    ${warnings}
    <div class="build-detail-layout">
      <div class="detail-column">
        ${statSection(build, 'Statistiques principales', [
          ['ap'], ['mp'], ['range'], ['vit'], ['power'], ['crit', '%'], ['wisdom'], ['summons']
        ])}
        ${statSection(build, 'Caractéristiques', [['earth'], ['fire'], ['water'], ['air']])}
        ${statSection(build, 'Secondaires', [
          ['initiative'], ['prospecting'], ['lock'], ['dodge'], ['apReduction'], ['mpReduction'], ['apParry'], ['mpParry'], ['heals']
        ])}
      </div>
      <div class="detail-column detail-equipment-column">
        <section class="detail-section"><h3>Équipement & FM</h3><div class="detail-gear-list">${renderDetailedEquipment(build)}</div></section>
        <section class="detail-section"><h3>Caractéristiques automatiques</h3><pre>${JSON.stringify(build.characteristics, null, 2)}</pre></section>
      </div>
      <div class="detail-column">
        ${statSection(build, 'Dommages', [
          ['damage'], ['damageNeutral'], ['damageEarth'], ['damageFire'], ['damageWater'], ['damageAir'],
          ['critDamage'], ['spellDamagePct', '%'], ['weaponDamagePct', '%'], ['pushbackDamage'], ['trapDamage'], ['trapPower']
        ])}
        ${statSection(build, 'Résistances %', [
          ['resNeutral', '%'], ['resEarth', '%'], ['resFire', '%'], ['resWater', '%'], ['resAir', '%'], ['critResistance'], ['pushbackResistance']
        ])}
        ${statSection(build, 'Résistances fixes', [
          ['fixedResNeutral'], ['fixedResEarth'], ['fixedResFire'], ['fixedResWater'], ['fixedResAir']
        ])}
        <section class="detail-section"><h3>Panoplies équipées</h3>${renderActiveSets(build)}</section>
      </div>
    </div>
    ${renderCombatPlan(build)}
    ${renderSpellDamageCards(build)}
  `;

  const modal = $('#build-modal');
  modal.classList.add('is-open');
  modal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('modal-open');
}

function renderBuilds(builds, emptyText) {
  displayedBuilds = Array.isArray(builds) ? builds : [];
  results.innerHTML = displayedBuilds.length
    ? displayedBuilds.map((build, index) => renderResult(build, index + 1, index)).join('')
    : `<div class="empty">${emptyText}</div>`;
}

results.addEventListener('click', (event) => {
  const card = event.target.closest('.result-card');
  if (!card) return;
  if (event.target.closest('details, summary, a, input, select')) return;
  const index = Number(card.dataset.buildIndex);
  openBuildModal(displayedBuilds[index], index + 1);
});

results.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const card = event.target.closest('.result-card');
  if (!card) return;
  event.preventDefault();
  const index = Number(card.dataset.buildIndex);
  openBuildModal(displayedBuilds[index], index + 1);
});

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
    if (Array.isArray(progress.partialResults) && progress.partialResults.length) latestPartialResults = progress.partialResults;
    const phase = progress.phase === 'combat-turn-refine' ? 'rotation · ' : progress.seeded ? 'base panoplies · ' : '';
    diagnostics.textContent = `${phase}${Number(progress.nodes || 0).toLocaleString('fr-FR')} nœuds · ${Number(progress.pruned || 0).toLocaleString('fr-FR')} branches coupées · meilleur ${fmt(progress.best)}`;
    return;
  }

  if (message.type === 'error') {
    results.innerHTML = `<div class="empty">Erreur de calcul : ${escapeHtml(message.message)}</div>`;
    diagnostics.textContent = 'Le solveur a rencontré une erreur.';
    setIdleState();
    return;
  }

  if (message.type !== 'result') return;
  const output = message.output;
  latestPartialResults = output.results || [];
  renderBuilds(output.results, 'Aucun build certifié ne satisfait les contraintes.');
  const fallback = output.diagnostics.fallbackUsed ? ` · fallback légal ${Number(output.diagnostics.fallbackValid || 0).toLocaleString('fr-FR')}` : '';
  const combat = output.diagnostics.combatRefine ? ` · rotations ${Number(output.diagnostics.combatRefine.evaluated || 0).toLocaleString('fr-FR')}` : '';
  diagnostics.textContent = `${output.diagnostics.visited.toLocaleString('fr-FR')} builds complets · ${output.diagnostics.nodes.toLocaleString('fr-FR')} nœuds · ${output.diagnostics.pruned.toLocaleString('fr-FR')} branches coupées${fallback}${combat}`;
  setIdleState();
}

function runSolver() {
  if (worker) {
    stopSolver();
    return;
  }
  if (!dataset || !spellData) return;

  const combatMode = isCombatMode();
  const selections = readSelections();
  if (!combatMode && !selections.some((selection) => selection.enabled)) {
    results.innerHTML = '<div class="empty">Active au moins un sort à optimiser.</div>';
    return;
  }

  const constraints = readConstraints();
  const scenario = readScenario();
  scenario.requiredApByTurn = combatMode ? {} : requiredApByTurn(selections);
  const requestId = ++activeRequestId;
  latestPartialResults = [];
  latestProgress = null;
  worker = new Worker(new URL('./optimizer-worker.js', import.meta.url), { type: 'module' });
  worker.addEventListener('message', (event) => handleWorkerMessage(event, requestId));
  worker.addEventListener('error', (event) => {
    if (requestId !== activeRequestId) return;
    results.innerHTML = `<div class="empty">Erreur du worker : ${escapeHtml(event.message || 'inconnue')}</div>`;
    diagnostics.textContent = 'Le calcul a été interrompu.';
    setIdleState();
  });

  const classSpells = spellsForBreed(spellData, breedSelect.value);
  const enabledCount = selections.filter((selection) => selection.enabled).length;
  const ap = scenario.requiredApByTurn;
  const comboText = activeTurnsForMode().map((turn) => `${ap[turn] || 0} PA T${turn}`).join(' · ');
  optimizeButton.textContent = 'Arrêter le calcul';
  results.innerHTML = '<div class="empty">Recherche en cours : panoplies, slots offensifs puis comparaison des dégâts…</div>';
  diagnostics.textContent = combatMode
    ? `Recherche du meilleur tour avec ${classSpells.length} sorts de combat…`
    : enabledCount === 1 ? 'Benchmark du sort sélectionné…' : `Combo demandé : ${comboText}`;

  worker.postMessage({
    type: 'optimize',
    requestId,
    payload: {
      items: dataset.items,
      sets: dataset.sets,
      selections,
      classSpells,
      objectiveMode: combatMode ? 'combat' : 'manual',
      combatObjective: readCombatObjective(),
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
  $('#objective-mode').addEventListener('change', syncObjectiveControls);
  $('#combat-target-mode').addEventListener('change', syncObjectiveControls);
  $('#combat-turns').addEventListener('change', syncTurnInputs);
  syncObjectiveControls();
}

function initBreedSelect() {
  breedSelect.innerHTML = spellData.breeds.map((breed) => `<option value="${breed.id}">${breed.name} · ${breed.spellIds.length} sorts</option>`).join('');
  breedSelect.disabled = false;
  breedSelect.addEventListener('change', () => {
    if (worker) stopSolver();
    renderSpellRows();
    results.innerHTML = '<div class="empty">Choisis ton objectif puis lance l’optimisation.</div>';
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
    const variants = Number(spellData.coverage?.variantsCertified || 0);
    const support = Number(spellData.coverage?.supportOnly || 0);
    const buffSpells = Number(spellData.coverage?.combatModifierSpells || 0);
    $('#version').textContent = `V${APP_VERSION} · Dofus ${equipmentVersion}`;
    dataStatus.textContent = `${dataset.items.length.toLocaleString('fr-FR')} équipements · ${dataset.sets.length.toLocaleString('fr-FR')} panoplies · ${spellData.spells.length.toLocaleString('fr-FR')} sorts de combat · ${variants.toLocaleString('fr-FR')} variantes · ${buffSpells.toLocaleString('fr-FR')} sorts avec buff/debuff · ${support.toLocaleString('fr-FR')} supports purs · calcul 100% local`;
    initBreedSelect();
    results.innerHTML = '<div class="empty">Bases réelles chargées. Choisis ta classe et ton objectif.</div>';
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
