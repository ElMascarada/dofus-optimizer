import { BASE_CHARACTER } from '../config.js';
import { evaluateCompleteBuild } from '../complete-build-evaluator.js';
import { evaluateSpell } from '../spell-evaluator.js';
import { spellsForBreed } from '../spell-selection.js';
import { workshopBuildIsComplete, workshopItems } from './workshop-build.js';

function clock() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function selectedSpellInputs(build, spellData) {
  const selected = new Set(build?.selectedSpells || []);
  return spellsForBreed(spellData, build?.classId)
    .filter((spell) => selected.has(spell.id) && (spell.hits || []).length > 0)
    .map((spell) => ({ enabled: true, weight: 1, spell, casts: { 1: 1, 2: 0, 3: 0 } }));
}

export function evaluateWorkshopBuild({
  build,
  dataset,
  spellData,
  character = BASE_CHARACTER,
  scenario = {}
} = {}) {
  const startedAt = clock();
  const items = workshopItems(build);
  const selections = selectedSpellInputs(build, spellData);
  const evaluation = evaluateCompleteBuild({
    items,
    sets: dataset?.sets || [],
    selections,
    constraints: {},
    fmPolicy: build?.fmPolicy || {},
    turnMode: 't1',
    character,
    // Workshop selections describe spells to evaluate, not a mandatory cast plan.
    // Executable rotations are solved later by analyzeWorkshopTurns().
    scenario: { ...scenario, requiredApByTurn: {} }
  });

  if (!evaluation.result) {
    return {
      valid: false,
      reason: evaluation.reason || 'evaluation-failed',
      items,
      stats: null,
      activeSets: [],
      spells: [],
      combatSpells: [],
      complete: workshopBuildIsComplete(build),
      recalculationMs: Math.max(0, clock() - startedAt)
    };
  }

  const stats = evaluation.result.effectiveStatsByTurn?.[1] || evaluation.result.stats;
  const classSpells = build?.classId ? spellsForBreed(spellData, build.classId) : [];
  const spells = classSpells
    .filter((spell) => (spell.hits || []).length > 0)
    .map((spell) => ({ spell, evaluation: evaluateSpell(spell, stats, { turn: 1 }) }))
    .filter((entry) => entry.evaluation.supported);

  return {
    valid: true,
    reason: null,
    items,
    stats: evaluation.result.stats,
    effectiveStats: stats,
    effectiveStatsByTurn: evaluation.result.effectiveStatsByTurn || {},
    activeSets: evaluation.result.activeSets || [],
    characteristics: evaluation.result.characteristics,
    fm: evaluation.result.fm,
    spells,
    combatSpells: classSpells.filter((spell) => spell?.combatRelevant !== false),
    complete: workshopBuildIsComplete(build),
    recalculationMs: Math.max(0, clock() - startedAt)
  };
}
