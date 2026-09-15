export function readPendingConstraint({ keyElement, numberElement, fmElement } = {}) {
  const key = String(keyElement?.value || '').trim();
  if (!key) return { present: false, valid: true, key: '', value: null };

  if (key === 'fm') {
    return {
      present: true,
      valid: true,
      key,
      value: Number(fmElement?.value || 0) === 1 ? 1 : 0
    };
  }

  const value = Number(numberElement?.value || 0);
  return {
    present: true,
    valid: Number.isFinite(value) && value > 0,
    key,
    value
  };
}

export function installOptimizerConstraintStateUx(doc = globalThis.document) {
  if (!doc) return;

  const optimizerView = doc.querySelector('#optimizer-view');
  const results = doc.querySelector('#optimizer-results');
  const diagnostics = doc.querySelector('#optimizer-diagnostics');
  const run = doc.querySelector('#optimizer-run');
  const constraintKey = doc.querySelector('#optimizer-constraint-key');
  const constraintValue = doc.querySelector('#optimizer-constraint-value');
  const constraintFmValue = doc.querySelector('#optimizer-constraint-fm-value');
  const constraintAdd = doc.querySelector('#optimizer-constraint-add');
  const activeConstraints = doc.querySelector('#optimizer-active-constraints');

  if (!optimizerView || !results || !run) return;

  const hasDisplayedBuild = () => Boolean(results.querySelector('[data-optimizer-result]'));

  const markResultsStale = () => {
    if (!hasDisplayedBuild()) return;
    results.dataset.state = 'stale';
    results.setAttribute('aria-busy', 'false');
    results.innerHTML = '<div class="ui-state" data-state="stale"><strong>Paramètres modifiés</strong><span>Relance l’optimisation pour obtenir un stuff correspondant aux réglages visibles.</span></div>';
    if (diagnostics) diagnostics.textContent = 'Paramètres modifiés — relance l’optimisation.';
  };

  const visibleParameterSelector = [
    '[data-optimizer-element]',
    '#optimizer-element-multi',
    '[data-optimizer-profile]',
    '[data-optimizer-crit-mode]',
    '#optimizer-min-ap',
    '#optimizer-min-mp',
    '#optimizer-constraint-key',
    '#optimizer-constraint-value',
    '#optimizer-constraint-fm-value'
  ].join(',');

  const invalidateFromVisibleParameter = (event) => {
    if (event.target?.matches?.(visibleParameterSelector)) markResultsStale();
  };

  optimizerView.addEventListener('input', invalidateFromVisibleParameter, true);
  optimizerView.addEventListener('change', invalidateFromVisibleParameter, true);
  constraintAdd?.addEventListener('click', markResultsStale, true);
  activeConstraints?.addEventListener('click', (event) => {
    if (event.target?.matches?.('[data-remove-optimizer-constraint]')) markResultsStale();
  }, true);

  run.addEventListener('click', (event) => {
    if (run.classList.contains('is-searching')) return;

    const pending = readPendingConstraint({
      keyElement: constraintKey,
      numberElement: constraintValue,
      fmElement: constraintFmValue
    });
    if (!pending.present) return;

    if (!constraintAdd) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (diagnostics) diagnostics.textContent = 'Impossible d’ajouter la contrainte avant la recherche.';
      return;
    }

    constraintAdd.click();
    if (!pending.valid) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);
}

if (typeof document !== 'undefined') installOptimizerConstraintStateUx(document);
