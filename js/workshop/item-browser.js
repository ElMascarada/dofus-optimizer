import { workshopSlot } from './workshop-build.js';
import { createItemSearchIndex } from './item-search.js';
import { escapeHtml, formatNumber, statLabel, statSuffix } from './ui-format.js';

const MAX_RESULTS = 120;

function itemStats(item = {}) {
  return Object.entries(item.stats || {})
    .filter(([, value]) => Number(value || 0) !== 0)
    .slice(0, 6)
    .map(([key, value]) => `${escapeHtml(statLabel(key))} <b>${formatNumber(value)}${statSuffix(key)}</b>`)
    .join(' · ');
}

function searchReasons(match, hasQuery) {
  if (!hasQuery || !match.reasons?.length) return '';
  return `<span class="workshop-search-reasons">${match.reasons.slice(0, 4)
    .map((reason) => `<em>${escapeHtml(reason)}</em>`).join('')}</span>`;
}

export function createItemBrowser(root, { items = [], sets = [], onSelect, onClose } = {}) {
  const byId = new Map(items.map((item) => [String(item.id), item]));
  const setNames = new Map(sets.map((set) => [String(set.id), set.name]));
  const searchIndex = createItemSearchIndex(items, sets);
  let activeSlotKey = null;
  let activeSlot = null;

  root.innerHTML = `
    <div class="workshop-browser-head">
      <div><span class="eyebrow">CATALOGUE</span><h3 id="workshop-browser-title">Choisir un item</h3></div>
      <button type="button" class="workshop-browser-close" data-browser-close aria-label="Fermer">×</button>
    </div>
    <label class="field workshop-search">Recherche intelligente
      <input type="search" data-browser-search placeholder="Ex. multi do crit, terre ini, anneau PA multi…" autocomplete="off">
    </label>
    <p class="hint workshop-search-hint">Nom ou vocabulaire déterministe : élément, multi, do crit, ini, vita, res, distance, mêlée, PA, PM, PO…</p>
    <p class="workshop-browser-count" data-browser-count></p>
    <div class="workshop-browser-results" data-browser-results></div>`;

  const searchInput = root.querySelector('[data-browser-search]');
  const results = root.querySelector('[data-browser-results]');
  const count = root.querySelector('[data-browser-count]');
  const title = root.querySelector('#workshop-browser-title');

  function render() {
    if (!activeSlot) return;
    const query = searchInput.value.trim();
    const search = searchIndex.search(query, { slot: activeSlot.slot, limit: MAX_RESULTS });
    const visible = search.results;
    count.textContent = `${search.total.toLocaleString('fr-FR')} item${search.total > 1 ? 's' : ''} compatible${search.total > 1 ? 's' : ''}${search.total > MAX_RESULTS ? ` · ${MAX_RESULTS} affichés` : ''}`;
    results.innerHTML = visible.map((match) => {
      const item = match.item;
      const setName = item.setId ? setNames.get(String(item.setId)) : null;
      const image = item.imageUrl ? `<img src="${escapeHtml(item.imageUrl)}" alt="" loading="lazy">` : '<span class="workshop-item-placeholder">◇</span>';
      return `
        <button type="button" class="workshop-item-row" data-browser-item="${escapeHtml(item.id)}">
          <span class="workshop-item-icon">${image}</span>
          <span class="workshop-item-copy"><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.typeName || activeSlot.label)} · niv. ${formatNumber(item.level, 0)}${setName ? ` · ${escapeHtml(setName)}` : ''}</small><span>${itemStats(item) || 'Aucune stat chiffrée'}</span>${searchReasons(match, Boolean(query))}</span>
        </button>`;
    }).join('') || '<div class="empty">Aucun item ne correspond à cette recherche.</div>';
  }

  searchInput.addEventListener('input', render);
  root.addEventListener('click', (event) => {
    if (event.target.closest('[data-browser-close]')) {
      root.hidden = true;
      onClose?.();
      return;
    }
    const target = event.target.closest('[data-browser-item]');
    if (!target) return;
    const item = byId.get(String(target.dataset.browserItem));
    if (item && activeSlotKey) onSelect?.(activeSlotKey, item);
  });

  return {
    open(slotKey) {
      const descriptor = workshopSlot(slotKey);
      if (!descriptor) return;
      activeSlotKey = descriptor.key;
      activeSlot = descriptor;
      title.textContent = descriptor.label;
      searchInput.value = '';
      root.hidden = false;
      render();
      searchInput.focus();
    },
    close() {
      root.hidden = true;
      onClose?.();
    },
    search(query) {
      if (!activeSlot) return { total: 0, results: [] };
      return searchIndex.search(query, { slot: activeSlot.slot, limit: MAX_RESULTS });
    }
  };
}
