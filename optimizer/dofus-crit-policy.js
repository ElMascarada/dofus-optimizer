export function isDofusTurquoise(item) {
  return /^Dofus Turquoise$/i.test(String(item?.name || ''));
}

export function dofusPackageMatchesCritMode(items = [], critMode = 'auto') {
  const mode = String(critMode || 'auto').trim().toLowerCase();
  const hasTurquoise = (items || []).some(isDofusTurquoise);
  if (mode === 'crit') return hasTurquoise;
  if (mode === 'no_crit') return !hasTurquoise;
  return true;
}
