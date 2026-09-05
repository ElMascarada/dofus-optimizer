export const INITIATIVE_COMPONENT_KEYS = Object.freeze(['earth', 'fire', 'water', 'air', 'initiative']);
const EFFECTIVE_STATS_DIRECT_INITIATIVE = Symbol('effectiveStatsDirectInitiative');

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

function directInitiative(stats = {}) {
  const preserved = stats?.[EFFECTIVE_STATS_DIRECT_INITIATIVE];
  return Number.isFinite(preserved) ? Number(preserved) : stat(stats, 'initiative');
}

// Initiative is derived from all four elemental characteristics plus the
// explicit Initiative bonus/malus. Keep the signed contribution available to
// search heuristics; only Dofus-facing effective Initiative is floored at zero.
export function initiativeContribution(stats = {}) {
  return INITIATIVE_COMPONENT_KEYS.reduce((sum, key) => {
    return sum + (key === 'initiative' ? directInitiative(stats) : stat(stats, key));
  }, 0);
}

export function derivedInitiative(stats = {}) {
  return Math.max(0, initiativeContribution(stats));
}

// Search bounds need separate optimistic and unavoidable signed pieces. These
// helpers keep Initiative semantics centralized instead of re-copying its
// component formula across candidate policy/search code.
export function positiveConstraintContribution(stats = {}, key) {
  if (key === 'initiative') {
    return INITIATIVE_COMPONENT_KEYS.reduce((sum, component) => {
      const value = component === 'initiative' ? directInitiative(stats) : stat(stats, component);
      return sum + Math.max(0, value);
    }, 0);
  }
  return Math.max(0, stat(stats, key));
}

export function negativeConstraintContribution(stats = {}, key) {
  if (key === 'initiative') {
    return INITIATIVE_COMPONENT_KEYS.reduce((sum, component) => {
      const value = component === 'initiative' ? directInitiative(stats) : stat(stats, component);
      return sum + Math.min(0, value);
    }, 0);
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
  const direct = directInitiative(stats);
  const result = cloneStats(stats);
  Object.defineProperty(result, EFFECTIVE_STATS_DIRECT_INITIATIVE, {
    value: direct,
    enumerable: false,
    configurable: false,
    writable: false
  });
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
