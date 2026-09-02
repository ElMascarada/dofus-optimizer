import { STAT_DEFINITION_BY_KEY } from '../stat-catalog.js';

export const WORKSHOP_STAT_LABELS = Object.freeze(Object.fromEntries(
  Object.entries(STAT_DEFINITION_BY_KEY).map(([key, definition]) => [key, definition.label])
));

export function escapeHtml(value = '') {
  return String(value).replace(/[&<>'\"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '\"': '&quot;'
  }[char]));
}

export function formatNumber(value, digits = 1) {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: digits }).format(Number(value || 0));
}

export function statLabel(key) {
  return WORKSHOP_STAT_LABELS[key] || key;
}

export function statSuffix(key) {
  return STAT_DEFINITION_BY_KEY[key]?.percent ? '%' : '';
}
