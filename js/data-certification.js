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
  if (item?.slot === 'dofus' || item?.slot === 'companion') return true;
  return Number(item?.level) >= 190;
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

// Legendary and other dynamic items can still contribute trustworthy fixed stats
// even when one active/meta effect is not modelled yet. Keep those items in the
// solver snapshot as "static only" instead of deleting them entirely. Unknown
// numeric effects or unknown conditions still exclude an item.
export function isStaticSnapshotSafeItem(item) {
  if (item?.certification?.certified) return true;
  if (!item?.certification?.slotKnown || !item?.certification?.conditionsCertified) return false;
  if (!item?.certification?.temporalEffectsPending) return false;
  return (item?.source?.effects || []).every((effect) => effect?.status !== 'unmapped');
}

export function selectSnapshotItems(items = [], sets = []) {
  const knownSetIds = new Set(sets.map((set) => set.id));
  const safeSetIds = new Set(sets.filter(isSolverSafeSet).map((set) => set.id));
  return items.filter((item) => {
    if (!isPlayerEquipmentScope(item)) return false;
    if (!isStaticSnapshotSafeItem(item)) return false;
    if (!item.setId) return true;
    return knownSetIds.has(item.setId) && safeSetIds.has(item.setId);
  });
}

export function sourceGeneratedAt(version, fallback) {
  return version?.update_stamp || version?.updateStamp || fallback;
}
