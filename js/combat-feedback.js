function num(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function activeTurns(turnMode = 't1') {
  if (turnMode === 't1') return [1];
  if (turnMode === 't2') return [2];
  if (turnMode === 't3') return [3];
  return [1, 2, 3];
}

function spellHasDirectDamage(spell) {
  return Array.isArray(spell?.hits) && spell.hits.length > 0;
}

/**
 * Build a new equipment objective from the rotations the combat solver actually
 * chose. This is deliberately feedback-driven: gear refinement must value the
 * spells that are really cast, not every offensive spell in the class kit with
 * an equal synthetic weight.
 */
export function buildCombatFeedbackSelections({
  results = [],
  spells = [],
  turnMode = 't1',
  maxPlans = 8
} = {}) {
  const allowedTurns = new Set(activeTurns(turnMode));
  const spellById = new Map((spells || []).map((spell) => [String(spell.id), spell]));
  const aggregate = new Map();
  let totalPlanWeight = 0;

  const plans = (results || []).slice(0, Math.max(1, Number(maxPlans || 8)));
  for (let index = 0; index < plans.length; index++) {
    const sequence = plans[index]?.combatPlan?.sequence || [];
    if (!sequence.length) continue;

    // The best current plan has the strongest influence, while still keeping a
    // few alternate rotations alive so a second equipment pass can escape a
    // local optimum.
    const planWeight = 1 / (index + 1);
    totalPlanWeight += planWeight;

    for (const entry of sequence) {
      const turn = Number(entry?.turn || 0);
      if (!allowedTurns.has(turn)) continue;
      const spell = spellById.get(String(entry?.spellId));
      if (!spellHasDirectDamage(spell)) continue;

      const id = String(spell.id);
      if (!aggregate.has(id)) {
        aggregate.set(id, {
          spell,
          casts: { 1: 0, 2: 0, 3: 0 },
          weightedDamage: 0
        });
      }
      const record = aggregate.get(id);
      record.casts[turn] += planWeight;
      record.weightedDamage += Math.max(0, num(entry?.expectedDamage, 0)) * planWeight;
    }
  }

  if (!(totalPlanWeight > 0)) return [];

  return [...aggregate.values()]
    .sort((a, b) => b.weightedDamage - a.weightedDamage)
    .map((record) => ({
      spell: { ...record.spell },
      enabled: true,
      weight: 1,
      casts: {
        1: record.casts[1] / totalPlanWeight,
        2: record.casts[2] / totalPlanWeight,
        3: record.casts[3] / totalPlanWeight
      }
    }));
}

/**
 * Stable candidate ordering used only to break exact offensive ties. If two
 * companions score the same for damage, a companion with more Vitality should
 * be considered first instead of losing arbitrarily because of source order.
 * The later real damage scorer still decides whenever offense differs.
 */
export function preferCompanionVitalityOnTies(items = []) {
  const companions = (items || [])
    .filter((item) => item?.slot === 'companion')
    .sort((a, b) => num(b?.stats?.vit) - num(a?.stats?.vit) || String(a?.id).localeCompare(String(b?.id)));

  let index = 0;
  return (items || []).map((item) => item?.slot === 'companion' ? companions[index++] : item);
}
