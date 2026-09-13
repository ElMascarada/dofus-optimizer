const STAT_LABELS = Object.freeze({
  ap: 'PA',
  mp: 'PM',
  range: 'PO',
  vit: 'Vitalité',
  initiative: 'Initiative',
  wisdom: 'Sagesse',
  earth: 'Force',
  fire: 'Intelligence',
  water: 'Chance',
  air: 'Agilité',
  power: 'Puissance',
  crit: 'Critique',
  critDamage: 'Do Critique',
  damage: 'Do fixe',
  damageNeutral: 'Do Neutre',
  damageEarth: 'Do Terre',
  damageFire: 'Do Feu',
  damageWater: 'Do Eau',
  damageAir: 'Do Air',
  spellDamagePct: '% Do Sorts',
  meleeDamagePct: '% Do Mêlée',
  rangedDamagePct: '% Do Distance',
  resNeutral: '% Ré Neutre',
  resEarth: '% Ré Terre',
  resFire: '% Ré Feu',
  resWater: '% Ré Eau',
  resAir: '% Ré Air',
  critResistance: 'Ré Critique',
  meleeResistance: '% Ré Mêlée',
  rangedResistance: '% Ré Distance',
  weaponResistance: '% Ré Armes',
  apParry: 'Esq. PA',
  mpParry: 'Esq. PM',
  apReduction: 'Ret. PA',
  mpReduction: 'Ret. PM',
  dodge: 'Fuite',
  lock: 'Tacle',
  prospecting: 'Prospection',
  summons: 'Invocations',
  heals: 'Soin',
  pods: 'Pods'
});

const RIGHT_STAT_KEYS = Object.freeze([
  'wisdom', 'range',
  'dodge', 'lock',
  'apParry', 'mpParry',
  'apReduction', 'mpReduction',
  'prospecting', 'summons',
  'heals', 'pods',
  'resNeutral', 'resEarth',
  'resFire', 'resWater',
  'resAir', 'critResistance',
  'meleeResistance', 'rangedResistance',
  'weaponResistance'
]);

function fmt(value, digits = 2) {
  const number = Number(value || 0);
  return Number.isFinite(number)
    ? number.toLocaleString('fr-FR', { maximumFractionDigits: digits })
    : '0';
}

function statNumber(stats, key) {
  const value = Number(stats?.[key] ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function itemLabel(item) {
  return item?.name || item?.id || 'Item';
}

function fallbackStatLabel(key) {
  return String(key || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/^./, (char) => char.toUpperCase());
}

function statLabel(key) {
  return STAT_LABELS[key] || fallbackStatLabel(key);
}

function renderTheoreticalDamage(result) {
  const minimum = Number(result?.syntheticOffense?.minimumScore || 0);
  return `<section class="optimizer-build-score" data-theoretical-damage="${Math.round(minimum)}">
    <span class="optimizer-kicker">Dégâts théoriques</span>
    <strong>${fmt(minimum, 0)}</strong>
  </section>`;
}

function assignmentLabel(assignment = {}) {
  if (assignment.type === 'exoAp') return 'Exo PA';
  if (assignment.type === 'exoMp') return 'Exo PM';
  if (assignment.type === 'critDamage') return `+${fmt(assignment.value, 0)} Do Crit`;
  if (assignment.type === 'spellDamagePct') return `+${fmt(assignment.value, 0)}% Do sorts`;
  return null;
}

function renderFm(result, items = []) {
  const fm = result?.fm || {};
  const itemById = new Map(items.map((item) => [String(item?.id ?? ''), item]));
  const changes = (fm.assignments || [])
    .map((assignment) => ({
      label: assignmentLabel(assignment),
      item: itemById.get(String(assignment?.itemId ?? ''))
    }))
    .filter((entry) => entry.label);

  const list = changes.length
    ? changes.map(({ label, item }) => `<li><span>${escapeHtml(itemLabel(item))}</span><strong>${escapeHtml(label)}</strong></li>`).join('')
    : '<li><span>Aucune modification</span><strong>—</strong></li>';

  return `<section class="optimizer-column-footer optimizer-build-fm" data-build-modifications>
    <span class="optimizer-kicker">Forgemagie</span>
    <p class="optimizer-build-summary-line">${fm.enabled ? 'FM Oui · Exo PA + PM inclus' : 'FM Non'}</p>
    <ul class="optimizer-change-list">${list}</ul>
  </section>`;
}

function itemsForSlot(items = [], slot) {
  return items.filter((item) => item?.slot === slot);
}

function renderLoadoutSlot(item, slotLabel, modifier = '') {
  if (!item) {
    return `<div class="optimizer-loadout-slot is-empty ${modifier}">
      <span class="optimizer-loadout-slot-label">${escapeHtml(slotLabel)}</span>
      <div class="optimizer-item-icon-placeholder" aria-hidden="true"></div>
    </div>`;
  }

  const name = itemLabel(item);
  const image = item?.imageUrl
    ? `<img src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(name)}" loading="lazy">`
    : '<div class="optimizer-item-icon-placeholder" aria-hidden="true"></div>';

  return `<div class="optimizer-loadout-slot ${modifier}" data-build-item="${escapeHtml(item.id)}" data-build-slot="${escapeHtml(item.slot)}" title="${escapeHtml(name)}">
    <span class="optimizer-loadout-slot-label">${escapeHtml(slotLabel)}</span>
    <div class="optimizer-item-icon">${image}</div>
    <strong>${escapeHtml(name)}</strong>
  </div>`;
}

function renderCharacterPortrait() {
  return `<div class="optimizer-character-portrait" data-character-portrait="neutral" aria-label="Portrait de personnage neutre">
    <svg viewBox="0 0 180 220" role="img" aria-hidden="true">
      <circle cx="90" cy="64" r="34"></circle>
      <path d="M46 182c7-46 31-70 44-70s37 24 44 70v22H46z"></path>
      <path d="M57 74c9-31 23-48 33-48 18 0 31 22 35 48-11-10-22-16-35-16-12 0-23 5-33 16z"></path>
    </svg>
    <span>Personnage · niveau 200</span>
  </div>`;
}

function renderLoadout(items = []) {
  const rings = itemsForSlot(items, 'ring');
  const dofus = itemsForSlot(items, 'dofus');

  const left = [
    ['amulet', 'Amulette', itemsForSlot(items, 'amulet')[0]],
    ['shield', 'Bouclier', itemsForSlot(items, 'shield')[0]],
    ['ring-1', 'Anneau 1', rings[0]],
    ['belt', 'Ceinture', itemsForSlot(items, 'belt')[0]],
    ['boots', 'Bottes', itemsForSlot(items, 'boots')[0]]
  ];
  const right = [
    ['hat', 'Coiffe', itemsForSlot(items, 'hat')[0]],
    ['weapon', 'Arme', itemsForSlot(items, 'weapon')[0]],
    ['ring-2', 'Anneau 2', rings[1]],
    ['cape', 'Cape', itemsForSlot(items, 'cape')[0]],
    ['companion', 'Familier', itemsForSlot(items, 'companion')[0]]
  ];

  return `<section class="optimizer-loadout" aria-label="Équipement du stuff">
    <div class="optimizer-loadout-side optimizer-loadout-left">
      ${left.map(([modifier, label, item]) => renderLoadoutSlot(item, label, modifier)).join('')}
    </div>
    ${renderCharacterPortrait()}
    <div class="optimizer-loadout-side optimizer-loadout-right">
      ${right.map(([modifier, label, item]) => renderLoadoutSlot(item, label, modifier)).join('')}
    </div>
    <div class="optimizer-dofus-row" aria-label="Dofus et trophées">
      ${Array.from({ length: 6 }, (_, index) => renderLoadoutSlot(dofus[index], `Slot ${index + 1}`, 'dofus-slot')).join('')}
    </div>
  </section>`;
}

function renderStat(key, value, options = {}) {
  const combined = options.combined;
  const combinedHtml = Number.isFinite(combined)
    ? ` <small class="optimizer-stat-combined">(${fmt(combined, 0)})</small>`
    : '';
  const dataCombined = options.combinedWith
    ? ` data-combined-with="${escapeHtml(options.combinedWith)}"`
    : '';

  return `<div class="optimizer-build-stat" data-stat-key="${escapeHtml(key)}"${dataCombined}>
    <span>${escapeHtml(statLabel(key))}</span>
    <strong>${fmt(value, 0)}${combinedHtml}</strong>
  </div>`;
}

function renderPrimaryStats(stats = {}) {
  const power = statNumber(stats, 'power');
  const fixedDamage = statNumber(stats, 'damage');
  const elementalStats = ['earth', 'fire', 'water', 'air']
    .map((key) => renderStat(key, statNumber(stats, key), {
      combined: statNumber(stats, key) + power,
      combinedWith: 'power'
    }))
    .join('');
  const elementalDamage = ['damageEarth', 'damageFire', 'damageWater', 'damageAir']
    .map((key) => renderStat(key, statNumber(stats, key), {
      combined: statNumber(stats, key) + fixedDamage,
      combinedWith: 'damage'
    }))
    .join('');

  return `<section class="optimizer-build-stat-panel optimizer-build-offense">
    <span class="optimizer-kicker">Stats & dégâts</span>
    <div class="optimizer-build-stat-grid" data-stat-group="primary-offense">
      ${renderStat('vit', statNumber(stats, 'vit'))}
      ${renderStat('initiative', statNumber(stats, 'initiative'))}
      ${elementalStats}
      ${renderStat('power', power)}
      ${renderStat('spellDamagePct', statNumber(stats, 'spellDamagePct'))}
      ${renderStat('damage', fixedDamage)}
      ${renderStat('damageNeutral', statNumber(stats, 'damageNeutral'))}
      ${elementalDamage}
      ${renderStat('meleeDamagePct', statNumber(stats, 'meleeDamagePct'))}
      ${renderStat('rangedDamagePct', statNumber(stats, 'rangedDamagePct'))}
      ${renderStat('crit', statNumber(stats, 'crit'))}
      ${renderStat('critDamage', statNumber(stats, 'critDamage'))}
    </div>
  </section>`;
}

function renderSecondaryStats(stats = {}) {
  return `<section class="optimizer-build-stat-panel optimizer-build-secondary">
    <span class="optimizer-kicker">Secondaires & défenses</span>
    <div class="optimizer-build-stat-grid" data-stat-group="secondary">
      ${RIGHT_STAT_KEYS.map((key) => renderStat(key, statNumber(stats, key))).join('')}
    </div>
  </section>`;
}

function numericStatEntries(stats = {}) {
  return Object.entries(stats)
    .filter(([, value]) => Number.isFinite(Number(value)) && Number(value) !== 0);
}

function renderSetBonuses(activeSets = []) {
  if (!activeSets.length) {
    return '<p class="optimizer-build-empty">Aucun bonus de panoplie actif.</p>';
  }

  return activeSets.map((set) => {
    const bonusEntries = numericStatEntries(set?.bonus || {});
    return `<article class="optimizer-set-bonus">
      <header><strong>${escapeHtml(set?.name || set?.setName || set?.setId || 'Panoplie')}</strong><span>×${Number(set?.count || 0)}</span></header>
      <div class="optimizer-set-bonus-stats">
        ${bonusEntries.map(([key, value]) => `<span><small>${escapeHtml(statLabel(key))}</small><strong>${Number(value) > 0 ? '+' : ''}${fmt(value, 0)}</strong></span>`).join('') || '<span><small>Bonus</small><strong>Actif</strong></span>'}
      </div>
    </article>`;
  }).join('');
}

function renderSetBonusCard(activeSets = []) {
  return `<section class="optimizer-column-footer optimizer-build-sets">
    <span class="optimizer-kicker">Bonus de panoplies</span>
    ${renderSetBonuses(activeSets)}
  </section>`;
}

export function renderOptimizerResult(result = {}, index = 0) {
  const stats = result?.stats || {};
  const items = result?.items || [];
  const activeSets = result?.activeSets || [];
  const title = index === 0 ? 'Meilleur stuff' : `Alternative ${index + 1}`;

  return `<article class="panel optimizer-result-card optimizer-build-card" data-optimizer-result="${index}"
      data-result-ap="${Number(stats.ap || 0)}"
      data-result-mp="${Number(stats.mp || 0)}"
      data-result-items="${items.length}">
    <header class="optimizer-build-header">
      <div>
        <span class="eyebrow">${index === 0 ? 'MEILLEUR RÉSULTAT' : 'ALTERNATIVE'}</span>
        <h3>${title}</h3>
      </div>
      <div class="optimizer-build-resources" aria-label="PA et PM">
        <span><strong>${fmt(stats.ap, 0)}</strong><small>PA</small></span>
        <span><strong>${fmt(stats.mp, 0)}</strong><small>PM</small></span>
      </div>
    </header>

    ${renderTheoreticalDamage(result)}

    <div class="optimizer-build-layout">
      <aside class="optimizer-build-summary">
        ${renderPrimaryStats(stats)}
        ${renderFm(result, items)}
      </aside>

      <div class="optimizer-build-equipment">
        ${renderLoadout(items)}
      </div>

      <aside class="optimizer-build-inspector">
        ${renderSecondaryStats(stats)}
        ${renderSetBonusCard(activeSets)}
      </aside>
    </div>

    <footer class="optimizer-build-footer">
      <button type="button" class="secondary" data-open-workshop="${index}">Ouvrir dans l’Atelier</button>
    </footer>
  </article>`;
}
