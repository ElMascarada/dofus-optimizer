import { loadDofusData, loadSpellData } from '../data-loader.js';
import { WorkshopController } from './workshop-controller.js';
import { createEquipmentGrid } from './equipment-grid.js';
import { createItemBrowser } from './item-browser.js';
import { renderStatsPanel } from './stats-panel.js';
import { renderSpellPanel } from './spell-panel.js';

const workshopView = document.querySelector('#workshop-view');
const optimizerView = document.querySelector('#optimizer-view');
const tabs = [...document.querySelectorAll('[data-product-tab]')];

function activateTab(tabId) {
  const workshopActive = tabId === 'workshop';
  workshopView.hidden = !workshopActive;
  optimizerView.hidden = workshopActive;
  for (const tab of tabs) {
    const active = tab.dataset.productTab === tabId;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', String(active));
  }
}

for (const tab of tabs) tab.addEventListener('click', () => activateTab(tab.dataset.productTab));
activateTab('workshop');

function renderSkeleton() {
  workshopView.innerHTML = `
    <section class="workshop-hero">
      <div><span class="eyebrow">ATELIER V2</span><h2>Construire. Mesurer. Ajuster.</h2><p>Équipe un stuff manuellement : les stats et dégâts sont recalculés par les moteurs canoniques.</p></div>
      <label class="field workshop-class-field">Classe<select id="workshop-class-select" disabled><option>Chargement…</option></select></label>
    </section>
    <p id="workshop-feedback" class="workshop-feedback" aria-live="polite"></p>
    <div class="workshop-layout">
      <section class="panel workshop-equipment-panel">
        <div class="workshop-panel-heading"><div><span class="eyebrow">ÉQUIPEMENT</span><h3>Stuff</h3></div><span class="pill">16 slots</span></div>
        <div id="workshop-equipment-grid" class="workshop-equipment-grid"></div>
      </section>
      <aside id="workshop-item-browser" class="panel workshop-item-browser" hidden></aside>
      <section id="workshop-stats-panel" class="panel workshop-stats-panel"><div class="empty">Chargement des données certifiées…</div></section>
    </div>
    <section class="panel workshop-spells-panel">
      <div class="workshop-panel-heading"><div><span class="eyebrow">COMBAT</span><h3>Dégâts des sorts · T1</h3></div><span class="pill">moteur générique</span></div>
      <div id="workshop-spell-panel"><div class="empty">Chargement du catalogue de sorts…</div></div>
    </section>`;
}

function feedback(message = '', kind = '') {
  const target = document.querySelector('#workshop-feedback');
  if (!target) return;
  target.textContent = message;
  target.dataset.kind = kind;
}

async function initWorkshop() {
  renderSkeleton();
  const classSelect = document.querySelector('#workshop-class-select');
  try {
    const [dataset, spellData] = await Promise.all([loadDofusData(), loadSpellData()]);
    const equipmentRoot = document.querySelector('#workshop-equipment-grid');
    const browserRoot = document.querySelector('#workshop-item-browser');
    const statsRoot = document.querySelector('#workshop-stats-panel');
    const spellsRoot = document.querySelector('#workshop-spell-panel');
    let controller = null;

    const browser = createItemBrowser(browserRoot, {
      items: dataset.items,
      sets: dataset.sets,
      onSelect(slotKey, item) {
        const update = controller.equip(slotKey, item);
        if (!update.accepted) {
          feedback(update.reason === 'special-slot-rule'
            ? 'Une seule Prysmaradite peut être équipée.'
            : 'Cet item n’est pas compatible avec ce slot.', 'error');
          return;
        }
        feedback(`${item.name} équipé.`, 'ok');
        browser.close();
      }
    });

    const equipment = createEquipmentGrid(equipmentRoot, {
      onOpen: (slotKey) => browser.open(slotKey),
      onRemove(slotKey) {
        controller.remove(slotKey);
        feedback('Item retiré.', 'ok');
      }
    });

    controller = new WorkshopController({
      dataset,
      spellData,
      onChange({ build, evaluation }) {
        equipment.render(build);
        renderStatsPanel(statsRoot, evaluation);
        renderSpellPanel(spellsRoot, evaluation, build.classId);
      }
    });

    classSelect.innerHTML = '<option value="">Choisir une classe</option>'
      + spellData.breeds.map((breed) => `<option value="${breed.id}">${breed.name}</option>`).join('');
    classSelect.disabled = false;
    classSelect.addEventListener('change', () => {
      controller.setClass(classSelect.value || null);
      feedback(classSelect.value ? 'Classe mise à jour.' : '', 'ok');
    });
    feedback(`${dataset.items.length.toLocaleString('fr-FR')} équipements certifiés disponibles.`, 'ok');
  } catch (error) {
    classSelect.disabled = true;
    feedback(error instanceof Error ? error.message : String(error), 'error');
    document.querySelector('#workshop-stats-panel').innerHTML = '<div class="empty">Impossible de charger l’Atelier.</div>';
    document.querySelector('#workshop-spell-panel').innerHTML = '<div class="empty">Catalogue de sorts indisponible.</div>';
  }
}

initWorkshop();
