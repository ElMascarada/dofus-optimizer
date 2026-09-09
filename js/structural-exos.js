import { cloneStats } from './stats.js';

export function structuralExoSelection(policy = {}) {
  const legacyPair = policy?.structuralExos === true;
  return {
    exoAp: Number(policy?.exoAp ?? (legacyPair ? 1 : 0)) === 1 ? 1 : 0,
    exoMp: Number(policy?.exoMp ?? (legacyPair ? 1 : 0)) === 1 ? 1 : 0
  };
}

export function applyStructuralExos(stats, selection = {}) {
  const { exoAp = 0, exoMp = 0 } = selection;
  if (exoAp) stats.ap = (stats.ap || 0) + 1;
  if (exoMp) stats.mp = (stats.mp || 0) + 1;
  return stats;
}

export function statsWithStructuralExos(baseStats = {}, policy = {}) {
  const selection = structuralExoSelection(policy);
  const stats = cloneStats(baseStats);
  applyStructuralExos(stats, selection);
  return { stats, ...selection, structuralExos: selection.exoAp + selection.exoMp };
}
