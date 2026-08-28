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

// Dofus-facing stat semantics live here. Keep raw aggregation separate so a
// negative Initiative penalty remains visible to signed search math while the
// effective in-game Initiative is floored at zero.
export function effectiveStat(stats, key) {
  const raw = stat(stats, key);
  if (key === 'initiative') return Math.max(0, raw);
  return raw;
}

export function effectiveStats(stats = {}) {
  const result = cloneStats(stats);
  if (Object.prototype.hasOwnProperty.call(result, 'initiative')) {
    result.initiative = effectiveStat(result, 'initiative');
  }
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
