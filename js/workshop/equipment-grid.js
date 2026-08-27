import { WORKSHOP_SLOTS } from './workshop-build.js';
import { escapeHtml } from './ui-format.js';

export function createEquipmentGrid(root, { onOpen, onRemove, onToggleLock, onReject } = {}) {
  root.addEventListener('click', (event) => {
    const lock = event.target.closest('[data-workshop-lock]');
    if (lock) {
      event.stopPropagation();
      onToggleLock?.(lock.dataset.workshopLock, lock.getAttribute('aria-pressed') !== 'true');
      return;
    }
    const reject = event.target.closest('[data-workshop-reject]');
    if (reject) {
      event.stopPropagation();
      onReject?.(reject.dataset.workshopReject);
      return;
    }
    const remove = event.target.closest('[data-workshop-remove]');
    if (remove) {
      event.stopPropagation();
      onRemove?.(remove.dataset.workshopRemove);
      return;
    }
    const slot = event.target.closest('[data-workshop-slot]');
    if (slot) onOpen?.(slot.dataset.workshopSlot);
  });

  root.addEventListener('keydown', (event) => {
    if (!['Enter', ' '].includes(event.key) || event.target.closest('button')) return;
    const slot = event.target.closest('[data-workshop-slot]');
    if (!slot) return;
    event.preventDefault();
    onOpen?.(slot.dataset.workshopSlot);
  });

  return {
    render(build = {}) {
      const locked = new Set(build?.lockedSlots || []);
      root.innerHTML = WORKSHOP_SLOTS.map(({ key, label }) => {
        const item = build.equipmentBySlot?.[key];
        const isLocked = Boolean(item && locked.has(key));
        const image = item?.imageUrl
          ? `<img src="${escapeHtml(item.imageUrl)}" alt="" loading="lazy">`
          : '<span class="workshop-slot-placeholder">+</span>';
        const slotAction = item ? `Modifier ${label} · ${item.name}` : `Choisir ${label}`;
        return `
          <article class="workshop-slot ${item ? 'is-filled' : ''} ${isLocked ? 'is-locked' : ''}" data-workshop-slot="${key}" tabindex="0" aria-label="${escapeHtml(slotAction)}">
            <span class="workshop-slot-label">${escapeHtml(label)}</span>
            <div class="workshop-slot-icon">${image}</div>
            <strong>${item ? escapeHtml(item.name) : 'Ajouter'}</strong>
            ${item ? `<div class="workshop-slot-actions" aria-label="Actions ${escapeHtml(label)}">
              <button type="button" class="workshop-slot-lock" data-workshop-lock="${key}" aria-pressed="${isLocked}" aria-label="${isLocked ? 'Déverrouiller' : 'Verrouiller'} ${escapeHtml(item.name)}" title="${isLocked ? 'Déverrouiller cet item' : 'Verrouiller cet item'}">${isLocked ? 'Verrouillé' : 'Verrouiller'}</button>
              <button type="button" class="workshop-slot-reject" data-workshop-reject="${key}" aria-label="Rejeter ${escapeHtml(item.name)}" title="Exclure cet item des prochaines recherches">Rejeter</button>
              <button type="button" class="workshop-slot-remove" data-workshop-remove="${key}" aria-label="Retirer ${escapeHtml(item.name)}" title="Retirer cet item">Retirer</button>
            </div>` : ''}
          </article>`;
      }).join('');
    }
  };
}
