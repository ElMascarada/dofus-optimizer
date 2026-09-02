import { escapeHtml, formatNumber, statLabel, statSuffix } from './ui-format.js';
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

function sourceText(source = {}) {
  const entries = Object.entries(source.stats || {});
  if (entries.length === 1 && entries[0][0] === 'finalDamagePct') {
    const amount = Number(entries[0][1] || 0);
    const prefix = amount > 0 ? '+' : '';
    return `${prefix}${formatNumber(amount, 0)}% ${escapeHtml(source.label || source.passiveId)}`;
  }
  const fragments = entries.map(([key, value]) => {
    const amount = Number(value || 0);
    const prefix = amount > 0 ? '+' : '';
    return `${prefix}${formatNumber(amount, 0)}${statSuffix(key)} ${escapeHtml(statLabel(key))}`;
  });
  return fragments.length ? `${fragments.join(', ')} · ${escapeHtml(source.label || source.passiveId)}` : '';
}

function t1Sources(evaluation) {
  const sources = (evaluation.t1DamageSources || []).map(sourceText).filter(Boolean);
  return sources.length ? `<small>Actif T1 : ${sources.join(' · ')}</small>` : '<small>Aucun bonus de dégâts temporel actif.</small>';
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

  const rows = (evaluation.spells || []).map(({ spell, staticEvaluation, t1Evaluation, evaluation: legacy }) => {
    const staticResult = staticEvaluation || legacy;
    const t1Result = t1Evaluation || legacy;
    return `
      <article class="workshop-spell-row" data-spell-truth="static-t1">
        <div class="workshop-spell-name"><strong>${escapeHtml(spell.name)}</strong><small>${formatNumber(spell.apCost, 0)} PA</small></div>
        <div><span>STATIQUE · Normal</span><b>${rangeText(staticResult.normalDamage)}</b><small>Crit ${rangeText(staticResult.criticalDamage)} · ${formatNumber(staticResult.critChancePct, 1)}%</small></div>
        <div><span>T1 EFFECTIF · Normal</span><b>${rangeText(t1Result.normalDamage)}</b><small>Crit ${rangeText(t1Result.criticalDamage)} · ${formatNumber(t1Result.critChancePct, 1)}%</small>${t1Sources(evaluation)}</div>
      </article>`;
  }).join('');

  root.innerHTML = `${rotationRows(evaluation)}${rows || '<div class="ui-state-inline" data-state="empty">Aucun sort offensif supporté pour cette classe.</div>'}`;
}
