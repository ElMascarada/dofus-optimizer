function enhanceBuildModal() {
  const content = document.querySelector('#build-modal-content');
  if (!content) return;

  const layout = content.querySelector('.build-detail-layout');
  const plan = content.querySelector('.combat-plan-section');
  if (plan && layout && plan.nextElementSibling !== layout) {
    content.insertBefore(plan, layout);
  }

  const scoreLabel = content.querySelector('.detail-score span')?.textContent?.trim();
  if (scoreLabel !== 'score objectif' || content.querySelector('.turn-plan-explainer')) return;

  const notice = document.createElement('div');
  notice.className = 'detail-warning turn-plan-explainer';
  const automaticMode = document.querySelector('#objective-mode')?.value === 'combat';
  notice.innerHTML = automaticMode
    ? '<strong>Résultat intermédiaire.</strong> La rotation finale n’a pas encore été calculée. Attends la fin de la recherche pour obtenir le détail exact des sorts, de leur ordre et des PA dépensés tour par tour.'
    : '<strong>Benchmark manuel.</strong> Ce score mesure le combo imposé dans les cases T1/T2/T3 ; ce n’est pas une rotation choisie par le solveur. Pour obtenir un vrai « meilleur tour possible » avec l’ordre exact des sorts, utilise le mode Meilleur tour possible (automatique).';

  const turns = content.querySelector('.detail-turns');
  if (turns) turns.insertAdjacentElement('afterend', notice);
  else content.prepend(notice);
}

const observer = new MutationObserver(enhanceBuildModal);
observer.observe(document.documentElement, { childList: true, subtree: true });
enhanceBuildModal();
