import {
  MIN_CONDITION_STATS,
  addMinCondition,
  getActiveMinConditions,
  removeMinCondition,
  setActiveMinConditions
} from './min-conditions.js';

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'\"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '\"': '&quot;'
  }[char]));
}

function definition(key) {
  return MIN_CONDITION_STATS.find((entry) => entry.key === key) || { key, label: key, percent: false };
}

function renderList(root) {
  const conditions = getActiveMinConditions();
  root.innerHTML = conditions.length
    ? conditions.map(({ key, value }) => {
      const stat = definition(key);
      return `<span class="pill" data-min-condition="${escapeHtml(key)}">Condition : ${escapeHtml(stat.label)} ≥ ${value}${stat.percent ? '%' : ''} <button type="button" data-remove-min-condition="${escapeHtml(key)}" aria-label="Supprimer la condition ${escapeHtml(stat.label)}">×</button></span>`;
    }).join('')
    : '<span class="hint">Aucune condition minimale supplémentaire.</span>';
}

function install() {
  const anchor = document.querySelector('.optimizer-v2-constraints');
  if (!anchor || document.querySelector('[data-min-condition-builder]')) return;

  const wrapper = document.createElement('div');
  wrapper.dataset.minConditionBuilder = 'true';
  wrapper.className = 'optimizer-min-condition-builder';
  wrapper.innerHTML = `
    <label class="field">Statistique
      <select id="optimizer-min-condition-stat">${MIN_CONDITION_STATS.map(({ key, label }) => `<option value="${escapeHtml(key)}">${escapeHtml(label)}</option>`).join('')}</select>
    </label>
    <label class="field">Minimum
      <input id="optimizer-min-condition-value" type="number" min="0" step="1" value="0">
    </label>
    <button id="optimizer-add-min-condition" type="button" class="secondary">Ajouter condition</button>
    <div id="optimizer-min-condition-list" class="optimizer-min-condition-list" aria-live="polite"></div>`;
  anchor.insertAdjacentElement('afterend', wrapper);

  const select = wrapper.querySelector('#optimizer-min-condition-stat');
  const input = wrapper.querySelector('#optimizer-min-condition-value');
  const addButton = wrapper.querySelector('#optimizer-add-min-condition');
  const list = wrapper.querySelector('#optimizer-min-condition-list');

  setActiveMinConditions([]);
  renderList(list);

  addButton.addEventListener('click', () => {
    setActiveMinConditions(addMinCondition(getActiveMinConditions(), { key: select.value, value: input.value }));
    renderList(list);
  });

  list.addEventListener('click', (event) => {
    const button = event.target.closest('[data-remove-min-condition]');
    if (!button) return;
    setActiveMinConditions(removeMinCondition(getActiveMinConditions(), button.dataset.removeMinCondition));
    renderList(list);
  });
}

install();
