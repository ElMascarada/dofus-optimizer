import { loadDofusData, loadSpellData } from '../data-loader.js';
import { BuildRepository } from './build-repository.js';
import { createBuildLibrary } from './build-library.js';
import { WORKSHOP_SLOTS, createWorkshopBuild, workshopBuildIsComplete } from './workshop-build.js';
import { WorkshopController } from './workshop-controller.js';
import { createEquipmentGrid } from './equipment-grid.js';
import { createItemBrowser } from './item-browser.js';
import { renderStatsPanel } from './stats-panel.js';
import { renderSpellPanel } from './spell-panel.js';
import { createWorkshopAutosave } from './workshop-autosave.js';
import { FIND_BETTER_BUILD_EVENT, OPEN_WORKSHOP_BUILD_EVENT } from './workshop-events.js';

const workshopView = document.querySelector('#workshop-view');
const optimizerView = document.querySelector('#optimizer-view');
const tabs = [...document.querySelectorAll('[data-product-tab]')];
const WORKSHOP_SLOT_COUNT = WORKSHOP_SLOTS.length;
let pendingOptimizerBuild = null;
let openOptimizerBuild = null;

function activateTab(tabId, { focus = false } = {}) {
  const workshopActive = tabId === 'workshop';
  workshopView.hidden = !workshopActive;
  optimizerView.hidden = workshopActive;
  for (const tab of tabs) {
    const active = tab.dataset.productTab === tabId;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
    if (active && focus) tab.focus();
  }
}

for (const tab of tabs) tab.addEventListener('click', () => activateTab(tab.dataset.productTab));
const tabList = document.querySelector('[role="tablist"]');
tabList?.addEventListener('keydown', (event) => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  const current = Math.max(0, tabs.indexOf(document.activeElement));
  const next = event.key === 'Home'
    ? 0
    : event.key === 'End'
      ? tabs.length - 1
      : event.key === 'ArrowRight'
        ? (current + 1) % tabs.length
        : (current - 1 + tabs.length) % tabs.length;
  event.preventDefault();
  activateTab(tabs[next].dataset.productTab, { focus: true });
});
activateTab('workshop');

document.addEventListener(OPEN_WORKSHOP_BUILD_EVENT, (event) => {
  const build = event?.detail?.build;
  if (!build) return;
  if (openOptimizerBuild) openOptimizerBuild(build);
  else pendingOptimizerBuild = build;
});

function renderSkeleton() {
  workshopView.setAttribute('aria-busy', 'true');
  workshopView.innerHTML = `
    <section class="workshop-hero">
      <div>
        <span class="eyebrow">ATELIER V2</span>
        <h2>Construire. Mesurer. Ajuster.</h2>
        <p>Compose ton stuff à la main. Les statistiques, dégâts et tours idéaux sont recalculés par les moteurs canoniques.</p>
      </div>
      <div class="workshop-hero-controls">
        <label class="field workshop-class-field">Classe<select id="workshop-class-select" disabled><option>Chargement…</option></select></label>
        <div class="workshop-find-better-actions">
          <button type="button" id="workshop-find-better" class="primary" disabled>Trouver mieux</button>
          <button type="button" id="workshop-clear-rejects" class="secondary" hidden>Effacer les rejets</button>
        </div>
        <small id="workshop-find-better-hint" class="workshop-find-better-hint">Choisis une classe et équipe au moins un item pour lancer une optimisation ciblée.</small>
      </div>
    </section>
    <p id="workshop-feedback" class="workshop-feedback" aria-live="polite"></p>
    <div class="workshop-layout">
      <section id="workshop-build-library" class="panel workshop-build-library"></section>
      <section class="panel workshop-equipment-panel">
        <div class="workshop-panel-heading">
          <div><span class="eyebrow">ÉQUIPEMENT</span><h3>Stuff</h3></div>
          <span id="workshop-slot-progress" class="pill workshop-progress-pill" data-complete="false">0 / 16</span>
        </div>
        <div id="workshop-equipment-grid" class="workshop-equipment-grid"></div>
      </section>
      <aside id="workshop-item-browser" class="panel workshop-item-browser" hidden></aside>
      <section id="workshop-stats-panel" class="panel workshop-stats-panel">
        <div class="ui-state" data-state="loading"><strong>Préparation des statistiques</strong><span>Chargement des équipements et des règles certifiées.</span></div>
      </section>
    </div>
    <section class="panel workshop-spells-panel">
      <div class="workshop-panel-heading"><div><span class="eyebrow">COMBAT</span><h3>Dégâts et rotation</h3></div><span class="pill">moteur générique</span></div>
      <div id="workshop-spell-panel"><div class="ui-state" data-state="loading"><strong>Préparation du combat</strong><span>Chargement du catalogue de sorts certifiés.</span></div></div>
    </section>`;
}

function feedback(message = '', kind = '') {
  const target = document.querySelector('#workshop-feedback');
  if (!target) return;
  target.textContent = message;
  target.dataset.kind = kind;
}

function hydrationMessage(hydrated, prefix) {
  const missing = hydrated?.missingItems?.length || 0;
  const incompatible = hydrated?.incompatibleItems?.length || 0;
  const stale = hydrated?.staleDataVersion;
  const details = [];
  if (missing) details.push(`${missing} item${missing > 1 ? 's' : ''} disparu${missing > 1 ? 's' : ''}`);
  if (incompatible) details.push(`${incompatible} item${incompatible > 1 ? 's' : ''} devenu${incompatible > 1 ? 's' : ''} incompatible${incompatible > 1 ? 's' : ''}`);
  if (stale) details.push('version de données différente');
  return details.length ? `${prefix} · ${details.join(' · ')}.` : prefix;
}

async function initWorkshop() {
  renderSkeleton();
  const classSelect = document.querySelector('#workshop-class-select');
  try {
    const [dataset, spellData] = await Promise.all([loadDofusData(), loadSpellData()]);
    const dataVersion = dataset.gameVersion?.version || dataset.generatedAt || null;
    const equipmentRoot = document.querySelector('#workshop-equipment-grid');
    const browserRoot = document.querySelector('#workshop-item-browser');
    const statsRoot = document.querySelector('#workshop-stats-panel');
    const spellsRoot = document.querySelector('#workshop-spell-panel');
    const libraryRoot = document.querySelector('#workshop-build-library');
    const findBetterButton = document.querySelector('#workshop-find-better');
    const clearRejectsButton = document.querySelector('#workshop-clear-rejects');
    const progressPill = document.querySelector('#workshop-slot-progress');
    const findBetterHint = document.querySelector('#workshop-find-better-hint');
    const repository = new BuildRepository();
    let controller = null;
    let autosave = null;
    let suppressAutosave = false;
    let currentRecordId = null;
    let currentRecordName = '';

    classSelect.innerHTML = '<option value="">Choisir une classe</option>'
      + spellData.breeds.map((breed) => `<option value="${breed.id}">${breed.name}</option>`).join('');
    classSelect.disabled = false;

    async function records() {
      return repository.list();
    }

    async function refreshLibrary() {
      const saved = await records();
      library.render(saved, { currentId: currentRecordId, currentName: currentRecordName });
      return saved;
    }

    function applyHydrated(hydrated, { id = null, name = '' } = {}) {
      suppressAutosave = true;
      controller.replaceBuild(hydrated?.build || createWorkshopBuild());
      suppressAutosave = false;
      currentRecordId = id;
      currentRecordName = name;
      classSelect.value = controller.build.classId || '';
      library.setCurrent({ id, name });
      autosave?.queue(controller.build);
    }

    const library = createBuildLibrary(libraryRoot, {
      onNew: async () => {
        applyHydrated({ build: createWorkshopBuild() });
        await refreshLibrary();
        feedback('Nouveau brouillon prêt.', 'ok');
      },
      onSave: async ({ id, name }) => {
        try {
          const record = await repository.save(controller.build, {
            id,
            name: name || currentRecordName,
            dataVersion
          });
          currentRecordId = record.id;
          currentRecordName = record.name;
          await refreshLibrary();
          library.setStatus(`Sauvegardé · ${record.name}`, 'ok');
          feedback(`${record.name} sauvegardé.`, 'ok');
        } catch (error) {
          library.setStatus(error instanceof Error ? error.message : String(error), 'error');
        }
      },
      onLoad: async (id) => {
        try {
          const record = await repository.get(id);
          if (!record) return;
          const hydrated = repository.hydrate(record, { items: dataset.items, currentDataVersion: dataVersion });
          applyHydrated(hydrated, { id: record.id, name: record.name });
          await refreshLibrary();
          const message = hydrationMessage(hydrated, `${record.name} chargé`);
          feedback(message, hydrated.degraded ? 'error' : 'ok');
        } catch (error) {
          feedback(error instanceof Error ? error.message : String(error), 'error');
        }
      },
      onRename: async (id, name) => {
        try {
          const record = await repository.rename(id, name);
          if (!record) return;
          if (record.id === currentRecordId) currentRecordName = record.name;
          await refreshLibrary();
          library.setStatus(`Renommé · ${record.name}`, 'ok');
        } catch (error) {
          library.setStatus(error instanceof Error ? error.message : String(error), 'error');
        }
      },
      onDuplicate: async (id) => {
        try {
          const record = await repository.duplicate(id);
          if (!record) return;
          const hydrated = repository.hydrate(record, { items: dataset.items, currentDataVersion: dataVersion });
          applyHydrated(hydrated, { id: record.id, name: record.name });
          await refreshLibrary();
          feedback(`${record.name} créé.`, 'ok');
        } catch (error) {
          feedback(error instanceof Error ? error.message : String(error), 'error');
        }
      },
      onDelete: async (id) => {
        try {
          await repository.delete(id);
          if (id === currentRecordId) {
            currentRecordId = null;
            currentRecordName = '';
            library.setCurrent();
          }
          await refreshLibrary();
          feedback('Stuff supprimé de la bibliothèque.', 'ok');
        } catch (error) {
          feedback(error instanceof Error ? error.message : String(error), 'error');
        }
      }
    });

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
      onToggleLock(slotKey, locked) {
        controller.setSlotLocked(slotKey, locked);
        feedback(locked ? 'Item verrouillé pour la prochaine optimisation.' : 'Verrouillage retiré.', 'ok');
      },
      onReject(slotKey) {
        const item = controller.build.equipmentBySlot?.[slotKey];
        if (!item) return;
        controller.reject(slotKey);
        feedback(`${item.name} rejeté : il sera exclu des prochaines recherches.`, 'ok');
      },
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
        classSelect.value = build.classId || '';
        const rejectedCount = build.rejectedItemIds?.length || 0;
        const filledCount = Object.values(build.equipmentBySlot || {}).filter(Boolean).length;
        const complete = workshopBuildIsComplete(build);
        const canOptimize = Boolean(build.classId && filledCount > 0);
        const missingCount = Math.max(0, WORKSHOP_SLOT_COUNT - filledCount);
        clearRejectsButton.hidden = rejectedCount === 0;
        clearRejectsButton.textContent = rejectedCount ? `Effacer les rejets (${rejectedCount})` : 'Effacer les rejets';
        findBetterButton.disabled = !canOptimize;
        findBetterButton.textContent = complete ? 'Trouver mieux' : 'Compléter le stuff';
        progressPill.textContent = `${filledCount} / ${WORKSHOP_SLOT_COUNT}`;
        progressPill.dataset.complete = String(complete);
        findBetterHint.dataset.ready = String(canOptimize);
        findBetterHint.textContent = build.classId && complete
          ? 'Stuff complet : Trouver mieux conserve uniquement les items explicitement verrouillés.'
          : build.classId && filledCount > 0
            ? `${filledCount} item(s) conservé(s) · ${missingCount} slot(s) à compléter.`
            : 'Choisis une classe et équipe au moins un item pour lancer une optimisation ciblée.';
        if (autosave && !suppressAutosave) autosave.queue(build);
      }
    });

    autosave = createWorkshopAutosave(repository, {
      dataVersion,
      onSaved(record) {
        library.setStatus(`Brouillon autosauvegardé · ${new Date(record.updatedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`, 'ok');
      },
      onError(error) {
        library.setStatus(`Autosave indisponible · ${error instanceof Error ? error.message : String(error)}`, 'error');
      }
    });

    openOptimizerBuild = (build) => {
      applyHydrated({ build });
      activateTab('workshop');
      feedback('Résultat de l’Optimiseur ouvert dans l’Atelier.', 'ok');
    };
    if (pendingOptimizerBuild) {
      const build = pendingOptimizerBuild;
      pendingOptimizerBuild = null;
      openOptimizerBuild(build);
    }

    findBetterButton.addEventListener('click', () => {
      const filledCount = Object.values(controller.build.equipmentBySlot || {}).filter(Boolean).length;
      if (!controller.build.classId || filledCount === 0) {
        feedback('Choisis une classe et équipe au moins un item avant de lancer l’optimisation.', 'error');
        return;
      }
      const build = controller.build;
      activateTab('optimizer');
      document.dispatchEvent(new CustomEvent(FIND_BETTER_BUILD_EVENT, { detail: { build } }));
    });

    clearRejectsButton.addEventListener('click', () => {
      controller.clearRejected();
      feedback('Liste des rejets effacée.', 'ok');
    });

    classSelect.addEventListener('change', () => {
      controller.setClass(classSelect.value || null);
      feedback(classSelect.value ? 'Classe mise à jour.' : '', 'ok');
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') autosave.flush(controller.build);
    });

    let restored = null;
    try {
      restored = await autosave.restore({ items: dataset.items, currentDataVersion: dataVersion });
      await refreshLibrary();
    } catch (error) {
      library.setStatus(`Bibliothèque indisponible · ${error instanceof Error ? error.message : String(error)}`, 'error');
    }

    workshopView.setAttribute('aria-busy', 'false');
    if (restored) {
      applyHydrated(restored);
      feedback(hydrationMessage(restored, 'Brouillon restauré'), restored.degraded ? 'error' : 'ok');
    } else {
      feedback(`${dataset.items.length.toLocaleString('fr-FR')} équipements certifiés disponibles.`, 'ok');
      autosave.queue(controller.build);
    }
  } catch (error) {
    workshopView.setAttribute('aria-busy', 'false');
    classSelect.disabled = true;
    feedback(error instanceof Error ? error.message : String(error), 'error');
    document.querySelector('#workshop-stats-panel').innerHTML = '<div class="ui-state" data-state="error"><strong>Atelier indisponible</strong><span>Impossible de charger les données certifiées. Recharge la page pour réessayer.</span></div>';
    document.querySelector('#workshop-spell-panel').innerHTML = '<div class="ui-state" data-state="error"><strong>Sorts indisponibles</strong><span>Le catalogue de sorts n’a pas pu être chargé.</span></div>';
  }
}

initWorkshop();