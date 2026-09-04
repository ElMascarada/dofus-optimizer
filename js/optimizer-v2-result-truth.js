export function optimizerApMpTruth(build = {}) {
  const permanentAp = build.stats?.ap;
  const permanentMp = build.stats?.mp;
  const turn1 = build.effectiveStatsByTurn?.[1];
  const hasCompleteTurn1 = turn1?.ap != null && turn1?.mp != null;
  const differsFromPermanent = hasCompleteTurn1
    && (turn1.ap !== permanentAp || turn1.mp !== permanentMp);

  return {
    permanentAp,
    permanentMp,
    t1: differsFromPermanent ? { ap: turn1.ap, mp: turn1.mp } : null
  };
}
