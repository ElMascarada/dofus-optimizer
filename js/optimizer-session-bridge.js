(() => {
  const NativeWorker = window.Worker;
  if (typeof NativeWorker !== 'function') return;

  const searchCache = window.DofusOptimizerRuntime?.searchCache;
  if (!searchCache) throw new Error('Runtime cache metadata unavailable.');

  const CACHE_STORAGE_KEY = searchCache.storageKey;
  const REQUIRED_STORAGE_KEY = searchCache.requiredItemsKey;
  const CACHE_EPOCH = searchCache.epoch;
  const MAX_CACHE_ENTRIES = searchCache.maxEntries;
  const SLOT_CAPS = Object.freeze({
    hat: 1,
    cape: 1,
    amulet: 1,
    belt: 1,
    boots: 1,
    weapon: 1,
    shield: 1,
    ring: 2,
    companion: 1,
    dofus: 6
  });

  let catalog = { items: [], sets: [] };
  let itemById = new Map();
  let setById = new Map();
  let requiredItemIds = loadRequiredIds();

  function safeParse(value, fallback) {
    try {
      const parsed = JSON.parse(value);
      return parsed ?? fallback;
    } catch {
      return fallback;
    }
  }

  function loadRequiredIds() {
    try {
      const value = safeParse(localStorage.getItem(REQUIRED_STORAGE_KEY), []);
      return Array.isArray(value) ? [...new Set(value.map(String))] : [];
    } catch {
      return [];
    }
  }

  function saveRequiredIds() {
    try {
      localStorage.setItem(REQUIRED_STORAGE_KEY, JSON.stringify(requiredItemIds));
    } catch {
      // Local persistence is an optimisation, never a blocker for the solver.
    }
  }

  function normalizedText(value = '') {
    return String(value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }

  function fnv1a(text) {
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index++) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  function compactSelection(selection) {
    return {
      id: String(selection?.spell?.id || selection?.id || ''),
      enabled: selection?.enabled !== false,
      weight: Number(selection?.weight || 0),
      casts: selection?.casts || null
    };
  }

  function cacheFingerprint(payload = {}) {
    const itemSignature = (payload.items || []).map((item) => String(item.id)).join('|');
    const spellSignature = (payload.classSpells || []).map((spell) => String(spell.id)).join('|');
    const keyPayload = stableValue({
      epoch: CACHE_EPOCH,
      objectiveMode: payload.objectiveMode,
      breedId: payload.breedId ?? payload.classId ?? null,
      turnMode: payload.turnMode,
      combatObjective: payload.combatObjective || {},
      constraints: payload.constraints || {},
      fmPolicy: payload.fmPolicy || {},
      scenario: payload.scenario || {},
      diversityMode: payload.diversityMode || 'gear',
      topN: Number(payload.topN || 10),
      selections: (payload.selections || []).map(compactSelection),
      requiredItemIds: [...new Set((payload.requiredItemIds || []).map(String))].sort(),
      itemSignature: fnv1a(itemSignature),
      spellSignature: fnv1a(spellSignature)
    });
    return `${CACHE_EPOCH}:${fnv1a(JSON.stringify(keyPayload))}`;
  }

  function loadCacheEntries() {
    try {
      const entries = safeParse(localStorage.getItem(CACHE_STORAGE_KEY), []);
      return Array.isArray(entries) ? entries : [];
    } catch {
      return [];
    }
  }

  function cachedOutput(key) {
    const entry = loadCacheEntries().find((candidate) => candidate?.key === key);
    return entry?.output || null;
  }

  function storeCachedOutput(key, output) {
    if (!output || output?.diagnostics?.stoppedEarly) return;
    try {
      const entries = loadCacheEntries().filter((entry) => entry?.key !== key);
      entries.unshift({ key, savedAt: Date.now(), output });
      localStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_CACHE_ENTRIES)));
    } catch {
      // Quota/private mode: search still works normally.
    }
  }

  function sessionWorker(...args) {
    const worker = new NativeWorker(...args);
    const nativePostMessage = worker.postMessage.bind(worker);
    let activeCacheKey = null;

    worker.addEventListener('message', (event) => {
      const message = event.data || {};
      if (message.type !== 'result' || !activeCacheKey) return;
      storeCachedOutput(activeCacheKey, message.output);
    });

    worker.postMessage = (...postArgs) => {
      const message = postArgs[0] || {};
      if (message.type !== 'optimize') return nativePostMessage(...postArgs);

      const payload = {
        ...(message.payload || {}),
        requiredItemIds: [...requiredItemIds]
      };
      const patched = { ...message, payload };
      activeCacheKey = cacheFingerprint(payload);
      const cached = cachedOutput(activeCacheKey);

      if (cached) {
        queueMicrotask(() => {
          worker.dispatchEvent(new MessageEvent('message', {
            data: {
              type: 'result',
              requestId: message.requestId,
              output: {
                ...cached,
                diagnostics: {
                  ...(cached.diagnostics || {}),
                  cacheHit: true
                }
              }
            }
          }));
          queueMicrotask(() => {
            const diagnostics = document.getElementById('diagnostics');
            if (diagnostics) diagnostics.textContent = `Résultat instantané · cache local · ${requiredItemIds.length ? `${requiredItemIds.length} pièce${requiredItemIds.length > 1 ? 's' : ''} imposée${requiredItemIds.length > 1 ? 's' : ''}` : 'aucun équipement imposé'}`;
          });
        });
        return undefined;
      }

      return nativePostMessage(patched, ...postArgs.slice(1));
    };

    return worker;
  }

  sessionWorker.prototype = NativeWorker.prototype;
  Object.setPrototypeOf(sessionWorker, NativeWorker);
  window.Worker = sessionWorker;

  function requiredItems() {
    return requiredItemIds.map((id) => itemById.get(String(id))).filter(Boolean);
  }

  function slotCapacity(slot) {
    return Number(SLOT_CAPS[slot] || 1);
  }

  function addRequiredItem(item) {
    if (!item?.id) return;
    const id = String(item.id);
    const current = requiredItems();
    if (requiredItemIds.includes(id)) return;

    const sameSlot = current.filter((entry) => entry.slot === item.slot);
    const cap = slotCapacity(item.slot);
    if (sameSlot.length >= cap) {
      const removeCount = sameSlot.length - cap + 1;
      const removeIds = new Set(sameSlot.slice(0, removeCount).map((entry) => String(entry.id)));
      requiredItemIds = requiredItemIds.filter((entryId) => !removeIds.has(String(entryId)));
    }
    requiredItemIds.push(id);
    requiredItemIds = [...new Set(requiredItemIds)];
    saveRequiredIds();
    renderRequiredItems();
  }

  function addRequiredSet(set) {
    for (const id of set?.equipmentIds || []) {
      const item = itemById.get(String(id));
      if (item) addRequiredItem(item);
    }
    renderRequiredItems();
  }

  function removeRequiredItem(id) {
    requiredItemIds = requiredItemIds.filter((entry) => String(entry) !== String(id));
    saveRequiredIds();
    renderRequiredItems();
  }

  function clearRequiredItems() {
    requiredItemIds = [];
    saveRequiredIds();
    renderRequiredItems();
  }

  function panelMarkup() {
    return `
      <section class="panel" id="required-equipment-panel">
        <h2>5. Équipement imposé</h2>
        <p class="hint">Impose une pièce ou une panoplie, puis optimise le reste du stuff autour. Une pièce imposée est une contrainte stricte.</p>
        <label class="field">Ajouter un item ou une panoplie
          <input id="required-equipment-search" type="search" autocomplete="off" placeholder="Ex. Panoplie du Comte Harebourg">
        </label>
        <div id="required-equipment-suggestions" class="required-equipment-suggestions" hidden></div>
        <div id="required-equipment-list" class="required-equipment-list"><span class="muted">Aucune pièce imposée.</span></div>
        <div class="required-equipment-actions">
          <button type="button" id="required-equipment-rerun">Relancer avec ces pièces</button>
          <button type="button" id="required-equipment-clear">Tout libérer</button>
        </div>
      </section>`;
  }

  function ensurePanel() {
    if (document.getElementById('required-equipment-panel')) return;
    const fmHeading = [...document.querySelectorAll('.controls .panel h2')].find((heading) => heading.textContent.includes('FM offensive'));
    const fmPanel = fmHeading?.closest('.panel');
    if (!fmPanel) return;
    fmPanel.insertAdjacentHTML('beforebegin', panelMarkup());

    const input = document.getElementById('required-equipment-search');
    const suggestions = document.getElementById('required-equipment-suggestions');
    input?.addEventListener('input', () => renderSuggestions(input.value));
    input?.addEventListener('focus', () => renderSuggestions(input.value));
    suggestions?.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-kind][data-id]');
      if (!button) return;
      if (button.dataset.kind === 'set') addRequiredSet(setById.get(button.dataset.id));
      else addRequiredItem(itemById.get(button.dataset.id));
      if (input) input.value = '';
      suggestions.hidden = true;
    });
    document.getElementById('required-equipment-list')?.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-remove-required]');
      if (button) removeRequiredItem(button.dataset.removeRequired);
    });
    document.getElementById('required-equipment-clear')?.addEventListener('click', clearRequiredItems);
    document.getElementById('required-equipment-rerun')?.addEventListener('click', () => document.getElementById('optimize')?.click());
    document.addEventListener('click', (event) => {
      if (!event.target.closest('#required-equipment-panel')) suggestions.hidden = true;
    });
    renderRequiredItems();
  }

  function renderSuggestions(query) {
    const container = document.getElementById('required-equipment-suggestions');
    if (!container) return;
    const normalized = normalizedText(query);
    if (normalized.length < 2) {
      container.hidden = true;
      container.innerHTML = '';
      return;
    }

    const setMatches = catalog.sets
      .filter((set) => normalizedText(set.name).includes(normalized))
      .slice(0, 6)
      .map((set) => ({ kind: 'set', id: String(set.id), name: set.name, meta: `${(set.equipmentIds || []).length} pièces` }));
    const itemMatches = catalog.items
      .filter((item) => normalizedText(item.name).includes(normalized))
      .slice(0, 10)
      .map((item) => ({ kind: 'item', id: String(item.id), name: item.name, meta: item.typeName || item.slot || 'Équipement' }));
    const matches = [...setMatches, ...itemMatches].slice(0, 12);

    container.innerHTML = matches.length
      ? matches.map((entry) => `<button type="button" data-kind="${entry.kind}" data-id="${entry.id}"><strong>${escapeHtml(entry.name)}</strong><span>${escapeHtml(entry.meta)}</span></button>`).join('')
      : '<span class="muted">Aucun résultat.</span>';
    container.hidden = false;
  }

  function renderRequiredItems() {
    const container = document.getElementById('required-equipment-list');
    if (!container) return;
    const items = requiredItems();
    if (!items.length) {
      container.innerHTML = '<span class="muted">Aucune pièce imposée.</span>';
      return;
    }
    container.innerHTML = items.map((item) => {
      const image = item.imageUrl ? `<img src="${escapeHtml(item.imageUrl)}" alt="">` : '';
      const set = item.setId ? setById.get(String(item.setId)) : null;
      return `<div class="required-equipment-chip">${image}<span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(set?.name || item.typeName || item.slot || '')}</small></span><button type="button" data-remove-required="${escapeHtml(String(item.id))}" aria-label="Libérer ${escapeHtml(item.name)}">×</button></div>`;
    }).join('');
  }

  function escapeHtml(value = '') {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function enhanceBuildModal() {
    const content = document.getElementById('build-modal-content');
    if (!content) return;
    for (const row of content.querySelectorAll('.detail-gear-row')) {
      if (row.querySelector('[data-impose-result-item]')) continue;
      const name = row.querySelector('strong')?.textContent?.replace(/ · Prysmaradite$/, '').trim();
      if (!name) continue;
      const item = catalog.items.find((entry) => entry.name === name);
      if (!item) continue;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'impose-result-item';
      button.dataset.imposeResultItem = String(item.id);
      button.textContent = requiredItemIds.includes(String(item.id)) ? 'Imposée' : 'Imposer';
      button.disabled = requiredItemIds.includes(String(item.id));
      row.appendChild(button);
    }
  }

  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-impose-result-item]');
    if (!button) return;
    addRequiredItem(itemById.get(String(button.dataset.imposeResultItem)));
    enhanceBuildModal();
  });

  document.addEventListener('DOMContentLoaded', async () => {
    ensurePanel();
    try {
      const response = await fetch('./data/normalized/dofus-data.json', { cache: 'force-cache' });
      if (!response.ok) throw new Error(`catalogue ${response.status}`);
      catalog = await response.json();
      itemById = new Map((catalog.items || []).map((item) => [String(item.id), item]));
      setById = new Map((catalog.sets || []).map((set) => [String(set.id), set]));
      requiredItemIds = requiredItemIds.filter((id) => itemById.has(String(id)));
      saveRequiredIds();
      renderRequiredItems();
    } catch {
      const container = document.getElementById('required-equipment-list');
      if (container) container.innerHTML = '<span class="muted">Catalogue indisponible pour la sélection manuelle.</span>';
    }

    const modalContent = document.getElementById('build-modal-content');
    if (modalContent) new MutationObserver(enhanceBuildModal).observe(modalContent, { childList: true, subtree: true });
  });

  window.DofusOptimizerSession = {
    getRequiredItemIds: () => [...requiredItemIds],
    cacheFingerprint,
    clearRequiredItems
  };
})();
