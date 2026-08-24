// Dofusdude exposes records that still exist in Ankama's data even when they are
// not normal player-obtainable equipment. The upstream API currently has no
// dedicated "obtainable" flag, so exceptional historical/internal items live in
// this one curated registry instead of being special-cased throughout the app.
//
// Keep this list intentionally small and evidence-based. Normal quest/drop items
// with no recipe must NOT be excluded merely because they are not craftable.
const EXCLUDED_ITEMS = new Map([
  [8575, {
    name: 'Le Ramboton',
    reason: 'historical-unique-item'
  }]
]);

export function unavailableItemReason(item) {
  const ankamaId = Number(item?.ankamaId ?? item?.ankama_id ?? String(item?.id || '').replace(/^item-/, ''));
  if (!Number.isFinite(ankamaId)) return null;
  return EXCLUDED_ITEMS.get(ankamaId)?.reason || null;
}

export function isOptimizerAvailableItem(item) {
  return unavailableItemReason(item) == null;
}

export function excludedOptimizerItems() {
  return [...EXCLUDED_ITEMS.entries()].map(([ankamaId, entry]) => ({ ankamaId, ...entry }));
}
