import { escapeHtml, formatNumber } from './ui-format.js';

function rangeText(range = [0, 0]) {
  return `${formatNumber(range?.[0], 0)}–${formatNumber(range?.[1], 0)}`;
}

export function renderSpellPanel(root, evaluation, classId) {
  if (!classId) {
    root.innerHTML = '<div class="workshop-empty-inline">Choisis une classe pour afficher ses sorts offensifs supportés.</div>';
    return;
  }
  if (!evaluation?.valid) {
    root.innerHTML = '<div class="workshop-empty-inline">Corrige le build pour recalculer les dégâts exacts.</div>';
    return;
  }

  const rows = (evaluation.spells || []).map(({ spell, evaluation: result }) => `
    <article class="workshop-spell-row">
      <div class="workshop-spell-name"><strong>${escapeHtml(spell.name)}</strong><small>${formatNumber(spell.apCost, 0)} PA</small></div>
      <div><span>Normal</span><b>${rangeText(result.normalDamage)}</b></div>
      <div><span>Critique</span><b>${rangeText(result.criticalDamage)}</b></div>
      <div><span>Chance crit.</span><b>${formatNumber(result.critChancePct, 1)}%</b></div>
    </article>`).join('');

  root.innerHTML = rows || '<div class="workshop-empty-inline">Aucun sort offensif supporté pour cette classe.</div>';
}
