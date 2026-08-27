import { escapeHtml, formatNumber, statLabel, statSuffix } from './ui-format.js';

const PRIMARY_STATS = [
  'ap', 'mp', 'range', 'vit', 'initiative',
  'earth', 'fire', 'water', 'air', 'power',
  'crit', 'critDamage', 'damage'
];
const RESISTANCES = ['resNeutral', 'resEarth', 'resFire', 'resWater', 'resAir'];

function tiles(stats, keys) {
  return keys.map((key) => `
    <div class="workshop-stat">
      <span>${escapeHtml(statLabel(key))}</span>
      <b>${formatNumber(stats?.[key])}${statSuffix(key)}</b>
    </div>`).join('');
}

function setBonusText(bonus = {}) {
  return Object.entries(bonus)
    .filter(([, value]) => Number(value || 0) !== 0)
    .map(([key, value]) => `${escapeHtml(statLabel(key))} ${formatNumber(value)}${statSuffix(key)}`)
    .join(' · ');
}

export function renderStatsPanel(root, evaluation) {
  if (!evaluation?.valid) {
    const message = evaluation?.reason === 'item-condition'
      ? 'Une condition d’équipement n’est pas satisfaite.'
      : evaluation?.reason === 'structural-invalid'
        ? 'La combinaison d’équipements est structurellement invalide.'
        : 'Le build ne peut pas être évalué exactement.';
    root.innerHTML = `<div class="workshop-eval-error"><strong>Build invalide</strong><p>${message}</p></div>`;
    return;
  }

  const sets = (evaluation.activeSets || []).map((set) => `
    <div class="workshop-set-row">
      <strong>${escapeHtml(set.name)}</strong>
      <span>${set.count} pièce${set.count > 1 ? 's' : ''}</span>
      <small>${setBonusText(set.bonus) || 'Bonus actif'}</small>
    </div>`).join('') || '<div class="workshop-empty-inline">Aucune panoplie active.</div>';

  root.innerHTML = `
    <div class="workshop-panel-heading"><div><span class="eyebrow">BUILD LIVE</span><h3>Statistiques</h3></div><span class="workshop-speed">${formatNumber(evaluation.recalculationMs, 2)} ms</span></div>
    <div class="workshop-stat-grid">${tiles(evaluation.stats, PRIMARY_STATS)}</div>
    <h4>Résistances</h4>
    <div class="workshop-stat-grid workshop-res-grid">${tiles(evaluation.stats, RESISTANCES)}</div>
    <h4>Panoplies actives</h4>
    <div class="workshop-set-list">${sets}</div>`;
}
