function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function explicitTurnBonus(build, resource, permanent) {
  const explicit = build.resourceBonusesByTurn?.[1]?.[resource];
  if (explicit != null && Number.isFinite(Number(explicit))) return Number(explicit);

  // Backward-compatible fallback for old serialized results. New product results
  // expose resourceBonusesByTurn so display truth no longer depends on a value
  // that may later be reused by combat/rotation code.
  const effective = build.effectiveStatsByTurn?.[1]?.[resource];
  if (effective == null || !Number.isFinite(Number(effective))) return 0;
  return Number(effective) - permanent;
}

export function optimizerApMpTruth(build = {}) {
  const permanentAp = finite(build.stats?.ap);
  const permanentMp = finite(build.stats?.mp);
  const bonusAp = explicitTurnBonus(build, 'ap', permanentAp);
  const bonusMp = explicitTurnBonus(build, 'mp', permanentMp);
  const differsFromPermanent = bonusAp !== 0 || bonusMp !== 0;

  return {
    permanentAp,
    permanentMp,
    t1: differsFromPermanent
      ? {
          ap: permanentAp + bonusAp,
          mp: permanentMp + bonusMp,
          bonusAp,
          bonusMp
        }
      : null
  };
}
