export const INITIATIVE_COMPONENT_KEYS = Object.freeze(['earth', 'fire', 'water', 'air', 'initiative']);

export function emptyStats() {
  return Object.create(null);
}

export function cloneStats(stats = {}) {
  return { ...stats };
}

export function addStats(target, source = {}, multiplier = 1) {
  for (const [key, value] of Object.entries(source)) {
    if (Number.isFinite(value)) target[key] = (target[key] || 0) + value * multiplier;
  }
  return target;
}

export function sumStats(...sources) {
  const result = emptyStats();
  for (const source of sources) addStats(result, source);
  return result;
}

// Raw stat access deliberately preserves signed aggregation. Candidate Search
// and other diagnostic/heuristic consumers may need to see real penalties.
export function stat(stats, key) {
  return Number(stats?.[key] || 0);
}

// Initiative is derived from all four elemental characteristics plus the
// explicit Initiative bonus/malus. Keep the signed contribution available to
// search heuristics; only Dofus-facing effective Initiative is floored at zero.
export function initiativeContribution(stats = {}) {
  return INITIATIVE_COMPONENT_KEYS.reduce((sum, key) => sum + stat(stats, key), 0);
}

export function derivedInitiative(stats = {}) {
  return Math.max(0, initiativeContribution(stats));
}

// Search bounds need separate optimistic and unavoidable signed pieces. These
// helpers keep Initiative semantics centralized instead of re-copying its
// component formula across candidate policy/search code.
export function positiveConstraintContribution(stats = {}, key) {
  if (key === 'initiative') {
    return INITIATIVE_COMPONENT_KEYS.reduce((sum, component) => sum + Math.max(0, stat(stats, component)), 0);
  }
  return Math.max(0, stat(stats, key));
}

export function negativeConstraintContribution(stats = {}, key) {
  if (key === 'initiative') {
    return INITIATIVE_COMPONENT_KEYS.reduce((sum, component) => sum + Math.min(0, stat(stats, component)), 0);
  }
  return Math.min(0, stat(stats, key));
}

export function constraintStatContribution(stats = {}, key) {
  if (key === 'initiative') return initiativeContribution(stats);
  return stat(stats, key);
}

// Dofus-facing stat semantics live here. Keep raw aggregation separate so a
// negative Initiative penalty remains visible to signed search math while the
// effective in-game Initiative is floored at zero after the full derived sum.
export function effectiveStat(stats, key) {
  if (key === 'initiative') return derivedInitiative(stats);
  return stat(stats, key);
}

export function effectiveStats(stats = {}) {
  const result = cloneStats(stats);
  result.initiative = derivedInitiative(result);
  return result;
}

export function meetsConstraints(stats, constraints = {}) {
  for (const [key, minimum] of Object.entries(constraints)) {
    if (!Number.isFinite(minimum) || minimum <= 0) continue;
    if (effectiveStat(stats, key) < minimum) return false;
  }
  return true;
}

export function constraintDeficits(stats, constraints = {}) {
  const deficits = {};
  for (const [key, minimum] of Object.entries(constraints)) {
    if (!Number.isFinite(minimum) || minimum <= 0) continue;
    const missing = minimum - effectiveStat(stats, key);
    if (missing > 0) deficits[key] = missing;
  }
  return deficits;
}
