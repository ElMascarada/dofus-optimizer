// Heuristic-only priors for finding a strong incumbent early.
// They never force an item into the final build and never participate in exact pruning.
// The exact solver is always allowed to replace every one of these choices.

function normalizeName(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

const CORE_PATTERNS = [
  { pattern: 'nebuleux', weight: 12 },
  { pattern: 'pourpre', weight: 10 },
  { pattern: 'turquoise', weight: 9 },
  { pattern: 'dofus des glaces', weight: 8 }
];

const FLEX_PATTERNS = [
  { pattern: 'ocre', weight: 5 },
  { pattern: 'vulbis', weight: 4 }
];

export function dofusSeedPrior(item = {}) {
  if (item.slot !== 'dofus') return 0;
  const name = normalizeName(item.name);
  for (const entry of CORE_PATTERNS) if (name.includes(entry.pattern)) return entry.weight;
  for (const entry of FLEX_PATTERNS) if (name.includes(entry.pattern)) return entry.weight;
  if (item.slotSubtype === 'prysmaradite') return 3;
  return 0;
}

export function isCoreOffensiveDofus(item = {}) {
  return dofusSeedPrior(item) >= 8;
}

export function coreOffensiveDofus(candidates = []) {
  return candidates
    .filter(isCoreOffensiveDofus)
    .sort((a, b) => dofusSeedPrior(b) - dofusSeedPrior(a) || String(a.id).localeCompare(String(b.id)));
}
