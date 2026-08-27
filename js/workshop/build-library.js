import { escapeHtml } from './ui-format.js';

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
  }).format(date);
}

export function createBuildLibrary(root, {
  onNew,
  onSave,
  onLoad,
  onRename,
  onDuplicate,
  onDelete
} = {}) {
  let records = [];
  let activeId = null;

  root.innerHTML = `
    <div class="workshop-panel-heading">
      <div><span class="eyebrow">BIBLIOTHÈQUE</span><h3>Mes stuffs</h3></div>
      <span class="pill" data-library-count>0 sauvegardé</span>
    </div>
    <label class="field workshop-build-name">Nom du stuff
      <input type="text" maxlength="80" data-library-name placeholder="Ex. Iop Terre T1" autocomplete="off">
    </label>
    <div class="workshop-library-primary-actions">
      <button type="button" class="primary" data-library-save>Sauvegarder</button>
      <button type="button" data-library-new>Nouveau</button>
    </div>
    <label class="field">Stuffs sauvegardés
      <select data-library-list size="5" aria-label="Stuffs sauvegardés"></select>
    </label>
    <div class="workshop-library-actions">
      <button type="button" data-library-load>Charger</button>
      <button type="button" data-library-rename>Renommer</button>
      <button type="button" data-library-duplicate>Dupliquer</button>
      <button type="button" data-library-delete>Supprimer</button>
    </div>
    <p class="hint" data-library-status aria-live="polite">Le brouillon courant est sauvegardé automatiquement.</p>`;

  const nameInput = root.querySelector('[data-library-name]');
  const list = root.querySelector('[data-library-list]');
  const count = root.querySelector('[data-library-count]');
  const status = root.querySelector('[data-library-status]');
  const recordActions = [
    root.querySelector('[data-library-load]'),
    root.querySelector('[data-library-rename]'),
    root.querySelector('[data-library-duplicate]'),
    root.querySelector('[data-library-delete]')
  ];

  function selectedRecord() {
    return records.find((record) => record.id === list.value) || null;
  }

  function syncActions() {
    const hasSelection = Boolean(selectedRecord());
    for (const button of recordActions) button.disabled = !hasSelection;
  }

  function syncSelectionName() {
    const selected = selectedRecord();
    if (selected && selected.id !== activeId) nameInput.value = selected.name;
    syncActions();
  }

  list.addEventListener('change', syncSelectionName);
  root.querySelector('[data-library-new]').addEventListener('click', () => onNew?.());
  root.querySelector('[data-library-save]').addEventListener('click', () => onSave?.({
    id: activeId,
    name: nameInput.value.trim()
  }));
  root.querySelector('[data-library-load]').addEventListener('click', () => {
    const selected = selectedRecord();
    if (selected) onLoad?.(selected.id);
  });
  root.querySelector('[data-library-rename]').addEventListener('click', () => {
    const selected = selectedRecord();
    if (selected) onRename?.(selected.id, nameInput.value.trim());
  });
  root.querySelector('[data-library-duplicate]').addEventListener('click', () => {
    const selected = selectedRecord();
    if (selected) onDuplicate?.(selected.id);
  });
  root.querySelector('[data-library-delete]').addEventListener('click', () => {
    const selected = selectedRecord();
    if (selected) onDelete?.(selected.id);
  });

  return {
    render(nextRecords = [], { currentId = null, currentName = '' } = {}) {
      records = [...nextRecords];
      activeId = currentId ? String(currentId) : null;
      count.textContent = `${records.length} sauvegardé${records.length > 1 ? 's' : ''}`;
      list.innerHTML = records.length
        ? records.map((record) => `<option value="${escapeHtml(record.id)}"${record.id === activeId ? ' selected' : ''}>${escapeHtml(record.name)}${record.updatedAt ? ` · ${escapeHtml(formatDate(record.updatedAt))}` : ''}</option>`).join('')
        : '<option value="" disabled>Aucun stuff sauvegardé</option>';
      if (!list.value && records[0]) list.value = records[0].id;
      nameInput.value = currentName || records.find((record) => record.id === activeId)?.name || '';
      syncActions();
    },
    setStatus(message, kind = '') {
      status.textContent = message;
      status.dataset.kind = kind;
    },
    setCurrent({ id = null, name = '' } = {}) {
      activeId = id ? String(id) : null;
      nameInput.value = name || '';
      if (activeId && records.some((record) => record.id === activeId)) list.value = activeId;
      syncActions();
    },
    currentName() {
      return nameInput.value.trim();
    },
    selectedId() {
      return list.value || null;
    }
  };
}
