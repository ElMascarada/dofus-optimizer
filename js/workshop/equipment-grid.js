import { WORKSHOP_SLOTS } from './workshop-build.js';
import { escapeHtml } from './ui-format.js';

export function createEquipmentGrid(root, { onOpen, onRemove } = {}) {
  root.addEventListener('click', (event) => {
    const remove = event.target.closest('[data-workshop-remove]');
    if (remove) {
      event.stopPropagation();
      onRemove?.(remove.dataset.workshopRemove);
      return;
    }
    const slot = event.target.closest('[data-workshop-slot]');
    if (slot) onOpen?.(slot.dataset.workshopSlot);
  });

  return {
    render(build = {}) {
      root.innerHTML = WORKSHOP_SLOTS.map(({ key, label }) => {
        const item = build.equipmentBySlot?.[key];
        const image = item?.imageUrl
          ? `<img src="${escapeHtml(item.imageUrl)}" alt="" loading="lazy">`
          : '<span class="workshop-slot-placeholder">+</span>';
        return `
          <article class="workshop-slot ${item ? 'is-filled' : ''}" data-workshop-slot="${key}" tabindex="0">
            <span class="workshop-slot-label">${escapeHtml(label)}</span>
            <div class="workshop-slot-icon">${image}</div>
            <strong>${item ? escapeHtml(item.name) : 'Choisir un item'}</strong>
            ${item ? `<button type="button" class="workshop-slot-remove" data-workshop-remove="${key}" aria-label="Retirer ${escapeHtml(item.name)}">×</button>` : ''}
          </article>`;
      }).join('');
    }
  };
}
