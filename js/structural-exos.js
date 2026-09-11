import { cloneStats } from './stats.js';

export function structuralExoSelection(policy = {}) {
  const globalFm = policy?.enabled === true || policy?.fmEnabled === true;
  const legacyPair = policy?.structuralExos === true;
  const forcedPair = globalFm || legacyPair;
  return {
    exoAp: Number(policy?.exoAp ?? (forcedPair ? 1 : 0)) === 1 ? 1 : 0,
    exoMp: Number(policy?.exoMp ?? (forcedPair ? 1 : 0)) === 1 ? 1 : 0
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
