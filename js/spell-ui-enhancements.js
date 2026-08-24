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

let spellMetaById = new Map();

function normalized(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
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

function localSpellIconUrl(iconId) {
  const id = Number(iconId || 0);
  return id ? `./assets/spells/${id}.png` : '';
}

function remoteSpellIconUrl(iconId, scale = '2x') {
  const id = Number(iconId || 0);
  return id ? `https://api.dofusdu.de/dofus3/v1/img/spell/${scale}/${id}.png` : '';
}

function legacyRemoteSpellIconUrl(iconId) {
  const id = Number(iconId || 0);
  return id ? `https://api.dofusdu.de/dofus3/v1/img/spell/${id}-96.png` : '';
}

function spellIconIdFromImage(img) {
  const fromDataset = Number(img?.dataset?.spellIconId || 0);
  if (fromDataset > 0) return fromDataset;
  const src = String(img?.getAttribute?.('src') || img?.src || '');
  const patterns = [
    /\/assets\/spells\/(\d+)\.png(?:$|\?)/,
    /\/spell\/(?:1x|2x)\/(\d+)\.png(?:$|\?)/,
    /\/spell\/(\d+)(?:-96)?\.png(?:$|\?)/
  ];
  for (const pattern of patterns) {
    const match = src.match(pattern);
    if (match) return Number(match[1]);
  }
  return 0;
}

function attachIconFallback(img, iconId) {
  if (!img) return;
  const id = Number(iconId || spellIconIdFromImage(img) || 0);
  if (!(id > 0)) return;
  img.dataset.spellIconId = String(id);
  if (img.dataset.spellIconFallback === 'ready') return;
  img.dataset.spellIconFallback = 'ready';
  img.addEventListener('error', () => {
    const stage = img.dataset.fallbackStage || 'remote-2x';
    if (stage === 'remote-2x') {
      img.dataset.fallbackStage = 'remote-legacy-96';
      img.src = legacyRemoteSpellIconUrl(id);
      return;
    }
    if (stage === 'remote-legacy-96') {
      img.dataset.fallbackStage = 'remote-1x';
      img.src = remoteSpellIconUrl(id, '1x');
      return;
    }
    if (stage === 'remote-1x') {
      img.dataset.fallbackStage = 'local';
      img.src = localSpellIconUrl(id);
      return;
    }
    img.dataset.fallbackStage = 'failed';
    img.style.display = 'none';
  });
}

function setPreferredSpellIcon(img, iconId) {
  const id = Number(iconId || 0);
  if (!img || !(id > 0)) return;
  img.dataset.spellIconId = String(id);
  img.dataset.fallbackStage = 'remote-2x';
  img.style.display = '';
  attachIconFallback(img, id);
  const preferred = remoteSpellIconUrl(id, '2x');
  if (img.getAttribute('src') !== preferred) img.src = preferred;
}

function decorateSpellRows() {
  for (const row of document.querySelectorAll('#spell-list .spell-row')) {
    row.classList.remove(...ELEMENT_CLASS_NAMES);
    row.classList.add(`spell-element-${elementKeyForRow(row)}`);

    const spell = spellMetaById.get(row.dataset.spellId);
    const check = row.querySelector('.check');
    if (!spell?.iconId || !check) continue;
    let img = check.querySelector('.spell-selection-icon');
    if (!img) {
      img = document.createElement('img');
      img.className = 'spell-selection-icon';
      img.alt = '';
      img.loading = 'lazy';
      img.referrerPolicy = 'no-referrer';
      check.querySelector('input')?.insertAdjacentElement('afterend', img);
    }
    setPreferredSpellIcon(img, spell.iconId);
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
    .map((row) => row.querySelector('.check > span:not(.spell-variant-badge):not(.spell-support-badge)')?.textContent?.trim())
    .filter(Boolean);

  if (!names.length) {
    recap.innerHTML = '<strong>Sorts offensifs testés :</strong> aucun sort visible pour ce filtre.';
    return;
  }

  recap.innerHTML = `<strong>Sorts offensifs testés :</strong> ${names
    .map((name) => `<span class="combat-spell-name">${escapeHtml(name)}</span>`)
    .join('')}<small>Les supports purs certifiés restent ajoutés automatiquement au pool.</small>`;
}

function repairRenderedSpellIcons(root = document) {
  const images = root.querySelectorAll('.spell-damage-icon img, .combat-sequence-icon img');
  for (const img of images) {
    const iconId = spellIconIdFromImage(img);
    if (!(iconId > 0)) continue;
    img.referrerPolicy = 'no-referrer';
    setPreferredSpellIcon(img, iconId);
  }
}

function parseFrenchNumber(value = '') {
  return Number(String(value).replace(/\s/g, '').replace(',', '.').replace(/[^0-9.-]/g, '')) || 0;
}

function enhanceCombatPlan(modalContent) {
  const plan = modalContent.querySelector('.combat-plan-section');
  const layout = modalContent.querySelector('.build-detail-layout');
  const damage = modalContent.querySelector('.spell-damage-section');

  if (plan && layout && plan.dataset.uiEnhanced !== '1') {
    plan.dataset.uiEnhanced = '1';
    const title = plan.querySelector('h3');
    if (title) title.textContent = 'Tour idéal — rotation réelle';
    const explanation = plan.querySelector('.spell-damage-heading p');
    if (explanation) explanation.textContent = `${explanation.textContent} · seuls les sorts listés ici sont réellement lancés`;

    for (const block of plan.querySelectorAll('.combat-turn-block')) {
      const header = block.querySelector('header');
      if (!header || header.querySelector('.combat-pa-total')) continue;
      const costs = [...block.querySelectorAll('.combat-sequence-row')]
        .map((row) => parseFrenchNumber(row.querySelector('strong + span')?.textContent || ''));
      const spent = costs.reduce((sum, value) => sum + value, 0);
      const chip = document.createElement('small');
      chip.className = 'combat-pa-total';
      chip.textContent = `${spent} PA de coûts de sorts`;
      header.appendChild(chip);
    }
  }

  if (plan && layout && layout.previousElementSibling !== plan) {
    layout.insertAdjacentElement('beforebegin', plan);
  }

  if (damage && damage.dataset.uiEnhanced !== '1') {
    damage.dataset.uiEnhanced = '1';
    const title = damage.querySelector('h3');
    if (title) title.textContent = 'Comparatif individuel des sorts';
    const paragraph = damage.querySelector('.spell-damage-heading p');
    if (paragraph) paragraph.textContent = 'Chaque carte correspond à un lancer isolé. Les PA de toutes les cartes ne doivent surtout pas être additionnés.';
    damage.classList.add('spell-comparison-section');

    if (!plan) {
      const warning = document.createElement('div');
      warning.className = 'no-combat-plan-warning';
      warning.textContent = 'Aucune rotation automatique n’est attachée à ce résultat : ce bloc compare seulement les sorts un par un. Lance le mode « Optimisation automatique » pour obtenir le tour idéal sous contrainte de PA.';
      damage.insertAdjacentElement('afterbegin', warning);
    }
  }

  repairRenderedSpellIcons(modalContent);
}

function refreshModalEnhancements() {
  const modalContent = document.querySelector('#build-modal-content');
  if (modalContent?.children.length) enhanceCombatPlan(modalContent);
}

function refreshSpellUi() {
  decorateSpellRows();
  updateAutomaticSpellRecap();
  refreshModalEnhancements();
}

async function loadSpellMetadata() {
  try {
    const response = await fetch('./data/normalized/spell-data.json', { cache: 'no-cache' });
    if (!response.ok) return;
    const data = await response.json();
    spellMetaById = new Map((data.spells || []).map((spell) => [String(spell.id), spell]));
  } catch {
    spellMetaById = new Map();
  }
  refreshSpellUi();
}

const spellList = document.querySelector('#spell-list');
if (spellList) {
  new MutationObserver(() => requestAnimationFrame(refreshSpellUi))
    .observe(spellList, { childList: true, subtree: true });
}

new MutationObserver(() => requestAnimationFrame(refreshModalEnhancements))
  .observe(document.body, { childList: true, subtree: true });

for (const id of ['breed-select', 'combat-element', 'objective-mode']) {
  document.querySelector(`#${id}`)?.addEventListener('change', () => requestAnimationFrame(refreshSpellUi));
}

requestAnimationFrame(refreshSpellUi);
loadSpellMetadata();
