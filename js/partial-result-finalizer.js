import { refineCombatTurns } from './combat-turn-refiner.js';
import { diversifyBuilds } from './result-diversity.js';
import { keepCompleteCombatPlans } from './final-result-validator.js';

function spellMatchesElement(spell, element = 'multi') {
  if (element === 'multi' || !element) return Array.isArray(spell?.hits) && spell.hits.length > 0;
  return (spell?.hits || []).some((hit) => hit?.element === element);
}

export function combatSpellPool(classSpells = [], combatObjective = {}) {
  const element = combatObjective.element || 'multi';
  return (classSpells || []).filter((spell) => {
    const support = Array.isArray(spell?.combatModifiers) && spell.combatModifiers.length > 0;
    return support || spellMatchesElement(spell, element);
  });
}

export function finalizePartialCombatResults({
  results = [],
  classSpells = [],
  combatObjective = {},
  diversityMode = 'gear',
  topN = 10,
  candidateLimit = 20,
  onProgress = null
} = {}) {
  const requestedTopN = Math.max(1, Number(topN || 10));
  const limit = Math.max(requestedTopN, Number(candidateLimit || requestedTopN));
  const candidates = (results || [])
    .filter((build) => build?.items?.length)
    .slice(0, limit);
  const spells = combatSpellPool(classSpells, combatObjective);

  if (!candidates.length) {
    return {
      results: [],
      diagnostics: {
        evaluated: 0,
        candidates: 0,
        spellPool: spells.length,
        stoppedEarly: true
      }
    };
  }

  if (!spells.some((spell) => (spell.hits || []).length > 0)) {
    throw new Error('Aucun sort offensif disponible pour finaliser les rotations.');
  }

  const refined = refineCombatTurns({
    results: candidates,
    spells,
    combatObjective,
    topN: limit,
    preservePrysmaradites: diversityMode === 'prysma',
    onProgress
  });
  const complete = keepCompleteCombatPlans(refined.results, combatObjective.turnMode || 't1');
  const diversified = diversifyBuilds(complete, diversityMode, requestedTopN);

  return {
    results: diversified,
    diagnostics: {
      ...refined.diagnostics,
      candidates: candidates.length,
      spellPool: spells.length,
      returned: diversified.length,
      incompletePlansRejected: Math.max(0, refined.results.length - complete.length),
      stoppedEarly: true
    }
  };
}
