import { WORKSHOP_STAT_SECTIONS, statDisplayValue } from '../stat-catalog.js';
import { escapeHtml, formatNumber, statLabel, statSuffix } from './ui-format.js';
import { analyzeWorkshopTurns } from './workshop-turn-analysis.js';

function tiles(stats, definitions) {
  return definitions.map((definition) => `
    <div class="workshop-stat" data-stat-key="${escapeHtml(definition.key)}">
      <span>${escapeHtml(definition.label)}</span>
      <b>${formatNumber(statDisplayValue(stats, definition))}${definition.percent ? '%' : ''}</b>
    </div>`).join('');
}

function setBonusText(bonus = {}) {
  return Object.entries(bonus)
    .filter(([, value]) => Number(value || 0) !== 0)
    .map(([key, value]) => `${escapeHtml(statLabel(key))} ${formatNumber(value)}${statSuffix(key)}`)
    .join(' · ');
}

function turnIndicators(evaluation) {
  const analysis = analyzeWorkshopTurns(evaluation);
  if (!analysis) {
    return `
      <h4>Tours idéaux</h4>
      <div class="ui-state-inline" data-state="empty">Complète les 16 slots pour calculer une rotation cohérente T1–T3 sur ce build fixé.</div>`;
  }
  const turns = analysis.turns.map(({ turn, damage }) => `
    <div class="workshop-stat">
      <span>T${turn}</span>
      <b>${formatNumber(damage)}</b>
    </div>`).join('');
  return `
    <h4>Tours idéaux · rotation T1–T3</h4>
    <div class="workshop-stat-grid">${turns}
      <div class="workshop-stat"><span>Constant</span><b>${formatNumber(analysis.metrics.constant)}</b></div>
    </div>`;
}

function statSections(stats) {
  return WORKSHOP_STAT_SECTIONS.map((section) => `
    <h4>${escapeHtml(section.label)}</h4>
    <div class="workshop-stat-grid${section.id === 'resistances' ? ' workshop-res-grid' : ''}" data-stat-section="${escapeHtml(section.id)}">${tiles(stats, section.stats)}</div>`).join('');
}

export function renderStatsPanel(root, evaluation) {
  if (!evaluation?.valid) {
    const message = evaluation?.reason === 'item-condition'
      ? 'Une condition d’équipement n’est pas satisfaite.'
      : evaluation?.reason === 'structural-invalid'
        ? 'La combinaison d’équipements est structurellement invalide.'
        : 'Le build ne peut pas être évalué exactement.';
    root.innerHTML = `<div class="ui-state" data-state="error" role="alert"><strong>Build invalide</strong><span>${message} Modifie les équipements concernés pour reprendre le calcul.</span></div>`;
    return;
  }

  const sets = (evaluation.activeSets || []).map((set) => `
    <div class="workshop-set-row">
      <strong>${escapeHtml(set.name)}</strong>
      <span>${set.count} pièce${set.count > 1 ? 's' : ''}</span>
      <small>${setBonusText(set.bonus) || 'Bonus actif'}</small>
    </div>`).join('') || '<div class="ui-state-inline" data-state="empty">Aucune panoplie active sur le stuff courant.</div>';

  root.innerHTML = `
    <div class="workshop-panel-heading"><div><span class="eyebrow">STATS LIVE</span><h3>Statistiques</h3></div><span class="workshop-speed" title="Temps de recalcul du build">${formatNumber(evaluation.recalculationMs, 2)} ms</span></div>
    ${turnIndicators(evaluation)}
    <p class="hint">Les statistiques ci-dessous décrivent le build statique. Les bonus temporels sont exposés séparément dans le panneau Sorts.</p>
    ${statSections(evaluation.stats)}
    <h4>Panoplies actives</h4>
    <div class="workshop-set-list">${sets}</div>`;
}
