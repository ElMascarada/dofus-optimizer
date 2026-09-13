const ELEMENT_LABELS = Object.freeze({
  earth: 'Terre',
  fire: 'Feu',
  water: 'Eau',
  air: 'Air',
  multi: 'Multi'
});

const DAMAGE_PROFILE_LABELS = Object.freeze({
  small: 'Petites lignes',
  medium: 'Mixte',
  large: 'Grosses lignes'
});

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
  damage: 'Dommages',
  damageNeutral: 'Do Neutre',
  damageEarth: 'Do Terre',
  damageFire: 'Do Feu',
  damageWater: 'Do Eau',
  damageAir: 'Do Air',
  spellDamagePct: '% Do Sorts',
  meleeDamagePct: '% Do Mêlée',
  rangedDamagePct: '% Do Distance',
  weaponDamagePct: '% Do Armes',
  finalDamagePct: '% Do Finaux',
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

const STAT_PRIORITY = Object.freeze([
  'ap', 'mp', 'range', 'vit', 'initiative', 'wisdom',
  'earth', 'fire', 'water', 'air', 'power',
  'crit', 'critDamage', 'damage', 'damageNeutral', 'damageEarth', 'damageFire', 'damageWater', 'damageAir',
  'spellDamagePct', 'meleeDamagePct', 'rangedDamagePct', 'weaponDamagePct', 'finalDamagePct',
  'resNeutral', 'resEarth', 'resFire', 'resWater', 'resAir', 'critResistance', 'meleeResistance', 'rangedResistance', 'weaponResistance',
  'dodge', 'lock', 'apParry', 'mpParry', 'apReduction', 'mpReduction', 'prospecting', 'summons', 'heals', 'pods'
]);

const SLOT_LABELS = Object.freeze({
  hat: 'Coiffe',
  cape: 'Cape',
  amulet: 'Amulette',
  ring: 'Anneau',
  belt: 'Ceinture',
  boots: 'Bottes',
  weapon: 'Arme',
  shield: 'Bouclier',
  companion: 'Compagnon',
  dofus: 'Dofus / trophée'
});

const BASELINE_ZERO_STATS = new Set(['ap', 'mp', 'range', 'vit', 'initiative']);

function fmt(value, digits = 2) {
  const number = Number(value || 0);
  return Number.isFinite(number)
    ? number.toLocaleString('fr-FR', { maximumFractionDigits: digits })
    : '0';
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

function sortStats(entries = []) {
  const priority = new Map(STAT_PRIORITY.map((key, index) => [key, index]));
  return [...entries].sort(([left], [right]) => {
    const leftRank = priority.has(left) ? priority.get(left) : Number.MAX_SAFE_INTEGER;
    const rightRank = priority.has(right) ? priority.get(right) : Number.MAX_SAFE_INTEGER;
    if (leftRank !== rightRank) return leftRank - rightRank;
    return left.localeCompare(right);
  });
}

function theoreticalDamageAxes(offense = {}) {
  const elements = Array.isArray(offense?.elements) ? offense.elements : [];
  if (elements.length === 1 && elements[0] === 'multi') {
    return Object.entries(offense?.multiElementScores || {})
      .filter(([element]) => ELEMENT_LABELS[element] && element !== 'multi')
      .map(([element, score]) => ({ element, score: Number(score || 0) }));
  }

  return elements
    .filter((element) => ELEMENT_LABELS[element] && element !== 'multi')
    .map((element) => {
      const scores = (offense?.requestedProbes || [])
        .filter((probe) => probe?.element === element)
        .map((probe) => Number(probe?.totalApBudgetScore || 0));
      return { element, score: scores.length ? Math.min(...scores) : 0 };
    });
}

function renderTheoreticalDamage(result) {
  const offense = result?.syntheticOffense || {};
  const probes = Array.isArray(offense?.requestedProbes) ? offense.requestedProbes : [];
  const profile = offense?.profiles?.[0] || probes?.[0]?.profile || '';
  const ap = Number(offense?.availableAp ?? result?.syntheticApBudget ?? result?.stats?.ap ?? 0);
  const critPct = Number(probes?.[0]?.effectiveCritChancePct || 0);
  const minimum = Number(offense?.minimumScore || 0);
  const mean = Number(offense?.meanScore || 0);
  const axes = theoreticalDamageAxes(offense);
  const multiAxis = axes.length > 1;
  const axisHtml = multiAxis
    ? `<div class="optimizer-damage-axes">${axes.map(({ element, score }) => `<span><small>${ELEMENT_LABELS[element]}</small><strong>${fmt(score, 0)}</strong></span>`).join('')}</div>`
    : '';

  return `<section class="optimizer-build-summary-card optimizer-damage-summary"
      data-theoretical-damage="${Math.round(minimum)}"
      data-theoretical-crit="${Math.round(critPct)}">
    <span class="optimizer-kicker">Dégâts théoriques</span>
    <div class="optimizer-damage-main">
      <strong>${fmt(minimum, 0)}</strong>
      <span>${multiAxis ? 'axe le plus faible' : 'sur le test standardisé'}</span>
    </div>
    <dl class="optimizer-compact-facts">
      <div><dt>Profil</dt><dd>${escapeHtml(DAMAGE_PROFILE_LABELS[profile] || profile || 'Standardisé')}</dd></div>
      <div><dt>Budget</dt><dd>${fmt(ap, 0)} PA</dd></div>
      <div><dt>Crit effectif</dt><dd>${fmt(critPct, 0)} %</dd></div>
      ${multiAxis ? `<div><dt>Moyenne</dt><dd>${fmt(mean, 0)}</dd></div>` : ''}
    </dl>
    ${axisHtml}
    <p class="optimizer-build-note">Attaques virtuelles standardisées utilisées par l’optimiseur pour comparer les stuffs.</p>
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
      assignment,
      label: assignmentLabel(assignment),
      item: itemById.get(String(assignment?.itemId ?? ''))
    }))
    .filter((entry) => entry.label);

  const list = changes.length
    ? changes.map(({ label, item }) => `<li><span>${escapeHtml(itemLabel(item))}</span><strong>${escapeHtml(label)}</strong></li>`).join('')
    : '<li><span>Aucune modification</span><strong>—</strong></li>';

  return `<section class="optimizer-build-summary-card" data-build-modifications>
    <span class="optimizer-kicker">Modifications</span>
    <p class="optimizer-build-summary-line">${fm.enabled ? 'FM Oui · Exo PA + PM inclus' : 'FM Non'}</p>
    <ul class="optimizer-change-list">${list}</ul>
  </section>`;
}

function renderCharacteristics(result) {
  const allocation = result?.characteristics || {};
  const entries = Object.entries(allocation).filter(([, value]) => Number(value || 0) !== 0);
  const content = entries.length
    ? entries.map(([key, value]) => `<li><span>${escapeHtml(ELEMENT_LABELS[key] || key)}</span><strong>+${fmt(value, 0)}</strong></li>`).join('')
    : '<li><span>Allocation</span><strong>Aucune</strong></li>';

  return `<section class="optimizer-build-summary-card">
    <span class="optimizer-kicker">Caractéristiques</span>
    <ul class="optimizer-change-list">${content}</ul>
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
    ['hat', 'Coiffe', itemsForSlot(items, 'hat')[0]],
    ['amulet', 'Amulette', itemsForSlot(items, 'amulet')[0]],
    ['ring-1', 'Anneau 1', rings[0]],
    ['belt', 'Ceinture', itemsForSlot(items, 'belt')[0]],
    ['boots', 'Bottes', itemsForSlot(items, 'boots')[0]]
  ];
  const right = [
    ['cape', 'Cape', itemsForSlot(items, 'cape')[0]],
    ['ring-2', 'Anneau 2', rings[1]],
    ['weapon', 'Arme', itemsForSlot(items, 'weapon')[0]],
    ['shield', 'Bouclier', itemsForSlot(items, 'shield')[0]],
    ['companion', 'Compagnon', itemsForSlot(items, 'companion')[0]]
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

function renderStats(stats = {}) {
  const entries = sortStats(Object.entries(stats)
    .filter(([key, value]) => Number.isFinite(Number(value)) && (Number(value) !== 0 || BASELINE_ZERO_STATS.has(key))));

  return `<div class="optimizer-build-stat-grid">
    ${entries.map(([key, value]) => `<div class="optimizer-build-stat" data-stat-key="${escapeHtml(key)}"><span>${escapeHtml(statLabel(key))}</span><strong>${fmt(value, 0)}</strong></div>`).join('')}
  </div>`;
}

function renderSetBonuses(activeSets = []) {
  if (!activeSets.length) {
    return '<p class="optimizer-build-empty">Aucun bonus de panoplie actif.</p>';
  }

  return activeSets.map((set) => {
    const bonusEntries = sortStats(Object.entries(set?.bonus || {}).filter(([, value]) => Number(value || 0) !== 0));
    return `<article class="optimizer-set-bonus">
      <header><strong>${escapeHtml(set?.name || set?.setName || set?.setId || 'Panoplie')}</strong><span>×${Number(set?.count || 0)}</span></header>
      <div class="optimizer-set-bonus-stats">
        ${bonusEntries.map(([key, value]) => `<span><small>${escapeHtml(statLabel(key))}</small><strong>${Number(value) > 0 ? '+' : ''}${fmt(value, 0)}</strong></span>`).join('') || '<span><small>Bonus</small><strong>Actif</strong></span>'}
      </div>
    </article>`;
  }).join('');
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

    <div class="optimizer-build-layout">
      <aside class="optimizer-build-summary">
        ${renderTheoreticalDamage(result)}
        ${renderFm(result, items)}
        ${renderCharacteristics(result)}
      </aside>

      <div class="optimizer-build-equipment">
        ${renderLoadout(items)}
      </div>

      <aside class="optimizer-build-inspector">
        <section class="optimizer-build-inspector-section">
          <span class="optimizer-kicker">Statistiques</span>
          ${renderStats(stats)}
        </section>
        <section class="optimizer-build-inspector-section optimizer-build-sets">
          <span class="optimizer-kicker">Bonus de panoplies</span>
          ${renderSetBonuses(activeSets)}
        </section>
      </aside>
    </div>

    <footer class="optimizer-build-footer">
      <button type="button" class="secondary" data-open-workshop="${index}">Ouvrir dans l’Atelier</button>
    </footer>
  </article>`;
}
