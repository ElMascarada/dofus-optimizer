export const WORKSHOP_STAT_LABELS = Object.freeze({
  ap: 'PA', mp: 'PM', range: 'PO', vit: 'Vitalité', initiative: 'Initiative',
  earth: 'Terre', fire: 'Feu', water: 'Eau', air: 'Air', power: 'Puissance',
  crit: 'Critique', critDamage: 'Do Crit', damage: 'Dommages',
  damageEarth: 'Do Terre', damageFire: 'Do Feu', damageWater: 'Do Eau', damageAir: 'Do Air',
  resNeutral: 'Rés. Neutre', resEarth: 'Rés. Terre', resFire: 'Rés. Feu', resWater: 'Rés. Eau', resAir: 'Rés. Air'
});

export function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[char]));
}

export function formatNumber(value, digits = 1) {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: digits }).format(Number(value || 0));
}

export function statLabel(key) {
  return WORKSHOP_STAT_LABELS[key] || key;
}

export function statSuffix(key) {
  return key === 'crit' || key.startsWith('res') || key.endsWith('Pct') ? '%' : '';
}
