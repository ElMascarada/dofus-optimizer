const CURATED_LOW_LEVEL_EQUIPMENT_IDS = new Set([
  13131 // Cape d'Ogivol
]);

export function isCuratedLowLevelEquipment(item) {
  const ankamaId = Number(item?.ankamaId ?? item?.ankama_id ?? String(item?.id || '').replace(/^item-/, ''));
  return Number.isFinite(ankamaId) && CURATED_LOW_LEVEL_EQUIPMENT_IDS.has(ankamaId);
}

export function curatedLowLevelEquipmentIds() {
  return [...CURATED_LOW_LEVEL_EQUIPMENT_IDS];
}
