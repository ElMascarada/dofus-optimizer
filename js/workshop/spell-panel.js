import { escapeHtml, formatNumber } from './ui-format.js';
import { analyzeWorkshopTurns } from './workshop-turn-analysis.js';

function rangeText(range = [0, 0]) {
  return `${formatNumber(range?.[0], 0)}–${formatNumber(range?.[1], 0)}`;
}

function actionText(action = {}) {
  const damage = Number(action.expectedDamage || 0);
  const damageText = damage > 0 ? ` · ${formatNumber(damage)} dégâts` : '';
  return `${escapeHtml(action.name || action.spellId)} (${formatNumber(action.apCost, 0)} PA${damageText} · ${formatNumber(action.apRemainingAfterCast, 0)} PA restants)`;
}

function rotationRows(evaluation) {
  const analysis = analyzeWorkshopTurns(evaluation);
  if (!analysis) return '';
  return `
    <h4>Rotation exacte T1–T3 · objectif cumul</h4>
    <div class="workshop-set-list">${analysis.turns.map(({ turn, damage, startAp, actions }) => `
      <div class="workshop-set-row">
        <strong>T${turn} · ${formatNumber(startAp, 0)} PA</strong>
        <span>${formatNumber(damage)} dégâts</span>
        <small>${actions.length ? actions.map(actionText).join(' → ') : 'Aucune action offensive retenue.'}</small>
      </div>`).join('')}</div>
    <p class="hint">La séquence conserve buffs, états, charges et cooldowns entre les tours. Les indicateurs T1/T2/T3 proviennent de cette même rotation cohérente.</p>`;
}

export function renderSpellPanel(root, evaluation, classId) {
  if (!classId) {
    root.innerHTML = '<div class="ui-state-inline" data-state="empty">Choisis une classe pour afficher les sorts offensifs supportés et leurs dégâts exacts.</div>';
    return;
  }
  if (!evaluation?.valid) {
    root.innerHTML = '<div class="ui-state-inline" data-state="error">Corrige le build invalide pour recalculer les dégâts et la rotation.</div>';
    return;
  }

  const rows = (evaluation.spells || []).map(({ spell, evaluation: result }) => `
    <article class="workshop-spell-row">
      <div class="workshop-spell-name"><strong>${escapeHtml(spell.name)}</strong><small>${formatNumber(spell.apCost, 0)} PA</small></div>
      <div><span>Normal</span><b>${rangeText(result.normalDamage)}</b></div>
      <div><span>Critique</span><b>${rangeText(result.criticalDamage)}</b></div>
      <div><span>Chance crit.</span><b>${formatNumber(result.critChancePct, 1)}%</b></div>
    </article>`).join('');

  root.innerHTML = `${rotationRows(evaluation)}${rows || '<div class="ui-state-inline" data-state="empty">Aucun sort offensif supporté pour cette classe.</div>'}`;
}
