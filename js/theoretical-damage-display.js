const ELEMENT_LABELS = Object.freeze({
  earth: 'Terre',
  fire: 'Feu',
  water: 'Eau',
  air: 'Air'
});

const PROFILE_LABELS = Object.freeze({
  small: 'Petites lignes',
  medium: 'Mixte',
  large: 'Grosses lignes'
});

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function axisScores(offense = {}) {
  const elements = Array.isArray(offense.elements) ? offense.elements : [];
  if (elements.length === 1 && elements[0] === 'multi') {
    return Object.entries(offense.multiElementScores || {})
      .filter(([element]) => ELEMENT_LABELS[element])
      .map(([element, score]) => ({
        element,
        label: ELEMENT_LABELS[element],
        score: finite(score)
      }));
  }

  return elements
    .filter((element) => ELEMENT_LABELS[element])
    .map((element) => {
      const scores = (offense.requestedProbes || [])
        .filter((probe) => probe?.element === element)
        .map((probe) => finite(probe?.totalApBudgetScore));
      return {
        element,
        label: ELEMENT_LABELS[element],
        score: scores.length ? Math.min(...scores) : 0
      };
    });
}

export function theoreticalDamageDisplayModel(result = {}) {
  const offense = result?.syntheticOffense || {};
  const probes = Array.isArray(offense.requestedProbes) ? offense.requestedProbes : [];
  const profile = offense?.profiles?.[0] || probes?.[0]?.profile || '';
  const axes = axisScores(offense);
  const critPct = finite(probes?.[0]?.effectiveCritChancePct);
  const availableAp = finite(offense.availableAp ?? result?.syntheticApBudget ?? result?.stats?.ap);
  const value = finite(offense.minimumScore);
  const mean = finite(offense.meanScore);

  return {
    value,
    mean,
    availableAp,
    profile,
    profileLabel: PROFILE_LABELS[profile] || profile || 'Profil standardisé',
    critPct,
    axes,
    multiAxis: axes.length > 1
  };
}
