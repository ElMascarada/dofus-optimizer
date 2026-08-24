const ELEMENT_CLASS_NAMES = [
  'spell-element-earth',
  'spell-element-fire',
  'spell-element-water',
  'spell-element-air',
  'spell-element-multi'
];

const ELEMENT_TEXT = {
  earth: 'terre',
  fire: 'feu',
  water: 'eau',
  air: 'air'
};

function normalized(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function rowElementText(row) {
  return normalized(row?.querySelector('.spell-facts > span:nth-child(3)')?.textContent || '');
}

function elementKeyForRow(row) {
  const text = rowElementText(row);
  const matches = Object.entries(ELEMENT_TEXT)
    .filter(([, label]) => text.includes(label))
    .map(([key]) => key);
  return matches.length === 1 ? matches[0] : 'multi';
}

function decorateSpellRows() {
  for (const row of document.querySelectorAll('#spell-list .spell-row')) {
    row.classList.remove(...ELEMENT_CLASS_NAMES);
    row.classList.add(`spell-element-${elementKeyForRow(row)}`);
  }
}

function ensureAutomaticSpellRecap() {
  const summary = document.querySelector('#combat-spell-summary');
  if (!summary) return null;
  let recap = document.querySelector('#combat-spell-name-recap');
  if (!recap) {
    recap = document.createElement('div');
    recap.id = 'combat-spell-name-recap';
    recap.className = 'combat-spell-name-recap';
    summary.insertAdjacentElement('afterend', recap);
  }
  return recap;
}

function updateAutomaticSpellRecap() {
  const recap = ensureAutomaticSpellRecap();
  if (!recap) return;

  const mode = document.querySelector('#objective-mode')?.value;
  if (mode !== 'combat') {
    recap.hidden = true;
    return;
  }
  recap.hidden = false;

  const selectedElement = document.querySelector('#combat-element')?.value || 'multi';
  const selectedLabel = ELEMENT_TEXT[selectedElement] || '';
  const names = [...document.querySelectorAll('#spell-list .spell-row')]
    .filter((row) => selectedElement === 'multi' || rowElementText(row).includes(selectedLabel))
    .map((row) => row.querySelector('.check > span')?.textContent?.trim())
    .filter(Boolean);

  if (!names.length) {
    recap.innerHTML = '<strong>Sorts offensifs testés :</strong> aucun sort visible pour ce filtre.';
    return;
  }

  recap.innerHTML = `<strong>Sorts offensifs testés :</strong> ${names
    .map((name) => `<span class="combat-spell-name">${escapeHtml(name)}</span>`)
    .join('')}<small>Les supports purs certifiés restent ajoutés automatiquement au pool.</small>`;
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  }[char]));
}

function refreshSpellUi() {
  decorateSpellRows();
  updateAutomaticSpellRecap();
}

const spellList = document.querySelector('#spell-list');
if (spellList) {
  new MutationObserver(() => requestAnimationFrame(refreshSpellUi))
    .observe(spellList, { childList: true, subtree: true });
}

for (const id of ['breed-select', 'combat-element', 'objective-mode']) {
  document.querySelector(`#${id}`)?.addEventListener('change', () => requestAnimationFrame(refreshSpellUi));
}

requestAnimationFrame(refreshSpellUi);
