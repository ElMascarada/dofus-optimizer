export function isSolverSafeSet(set) {
  if (!set?.certification?.certified) return false;
  return (set.certification.coverage || []).every((entry) => Number(entry.active ?? 0) === 0 && Number(entry.meta ?? 0) === 0);
}

function normalizeSearchText(value = '') {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

export function isInternalOrNonPlayerItem(item) {
  const typeName = normalizeSearchText(item?.typeName);
  const name = String(item?.name || '');
  if (typeName.includes('percepteur')) return true;
  if (/\(\s*mj\s*\)/i.test(name) || /\[\s*mj\s*\]/i.test(name)) return true;
  return false;
}

export function isPlayerEquipmentScope(item) {
  if (isInternalOrNonPlayerItem(item)) return false;
  return Number(item?.level) === 200 || item?.slot === 'dofus' || item?.slot === 'companion';
}

export function equipmentForCoverage(items = []) {
  return items.filter(isPlayerEquipmentScope);
}

export function collectUnknownSlotTypes(items = []) {
  const counts = {};
  for (const item of items) {
    if (item?.slot || !isPlayerEquipmentScope(item)) continue;
    const key = item?.typeName || 'UNKNOWN';
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

export function selectSnapshotItems(items = [], sets = []) {
  const knownSetIds = new Set(sets.map((set) => set.id));
  const safeSetIds = new Set(sets.filter(isSolverSafeSet).map((set) => set.id));
  return items.filter((item) => {
    if (!isPlayerEquipmentScope(item)) return false;
    if (!item?.certification?.certified) return false;
    if (!item.setId) return true;
    return knownSetIds.has(item.setId) && safeSetIds.has(item.setId);
  });
}

export function sourceGeneratedAt(version, fallback) {
  return version?.update_stamp || version?.updateStamp || fallback;
}
