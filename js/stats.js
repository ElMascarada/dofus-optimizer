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

export function stat(stats, key) {
  return Number(stats?.[key] || 0);
}

export function meetsConstraints(stats, constraints = {}) {
  for (const [key, minimum] of Object.entries(constraints)) {
    if (!Number.isFinite(minimum) || minimum <= 0) continue;
    if (stat(stats, key) < minimum) return false;
  }
  return true;
}

export function constraintDeficits(stats, constraints = {}) {
  const deficits = {};
  for (const [key, minimum] of Object.entries(constraints)) {
    if (!Number.isFinite(minimum) || minimum <= 0) continue;
    const missing = minimum - stat(stats, key);
    if (missing > 0) deficits[key] = missing;
  }
  return deficits;
}
