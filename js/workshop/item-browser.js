import { workshopSlot } from './workshop-build.js';
import { escapeHtml, formatNumber, statLabel, statSuffix } from './ui-format.js';

const MAX_RESULTS = 120;

function normalizeSearch(value = '') {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function itemStats(item = {}) {
  return Object.entries(item.stats || {})
    .filter(([, value]) => Number(value || 0) !== 0)
    .slice(0, 6)
    .map(([key, value]) => `${escapeHtml(statLabel(key))} <b>${formatNumber(value)}${statSuffix(key)}</b>`)
    .join(' · ');
}

export function createItemBrowser(root, { items = [], sets = [], onSelect, onClose } = {}) {
  const byId = new Map(items.map((item) => [String(item.id), item]));
  const setNames = new Map(sets.map((set) => [String(set.id), set.name]));
  let activeSlotKey = null;
  let activeSlot = null;

  root.innerHTML = `
    <div class="workshop-browser-head">
      <div><span class="eyebrow">CATALOGUE</span><h3 id="workshop-browser-title">Choisir un item</h3></div>
      <button type="button" class="workshop-browser-close" data-browser-close aria-label="Fermer">×</button>
    </div>
    <label class="field workshop-search">Recherche par nom
      <input type="search" data-browser-search placeholder="Ex. Torkélonia, Dofus…" autocomplete="off">
    </label>
    <p class="workshop-browser-count" data-browser-count></p>
    <div class="workshop-browser-results" data-browser-results></div>`;

  const searchInput = root.querySelector('[data-browser-search]');
  const results = root.querySelector('[data-browser-results]');
  const count = root.querySelector('[data-browser-count]');
  const title = root.querySelector('#workshop-browser-title');

  function render() {
    if (!activeSlot) return;
    const query = normalizeSearch(searchInput.value);
    const matches = items
      .filter((item) => item.slot === activeSlot.slot)
      .filter((item) => !query || normalizeSearch(item.name).includes(query))
      .sort((a, b) => Number(b.level || 0) - Number(a.level || 0) || String(a.name).localeCompare(String(b.name), 'fr'));
    const visible = matches.slice(0, MAX_RESULTS);
    count.textContent = `${matches.length.toLocaleString('fr-FR')} item${matches.length > 1 ? 's' : ''} compatible${matches.length > 1 ? 's' : ''}${matches.length > MAX_RESULTS ? ` · ${MAX_RESULTS} affichés` : ''}`;
    results.innerHTML = visible.map((item) => {
      const setName = item.setId ? setNames.get(String(item.setId)) : null;
      const image = item.imageUrl ? `<img src="${escapeHtml(item.imageUrl)}" alt="" loading="lazy">` : '<span class="workshop-item-placeholder">◇</span>';
      return `
        <button type="button" class="workshop-item-row" data-browser-item="${escapeHtml(item.id)}">
          <span class="workshop-item-icon">${image}</span>
          <span class="workshop-item-copy"><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.typeName || activeSlot.label)} · niv. ${formatNumber(item.level, 0)}${setName ? ` · ${escapeHtml(setName)}` : ''}</small><span>${itemStats(item) || 'Aucune stat chiffrée'}</span></span>
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
    }
  };
}
