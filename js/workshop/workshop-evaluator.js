import { BASE_CHARACTER } from '../config.js';
import { evaluateCompleteBuild } from '../complete-build-evaluator.js';
import { evaluateSpell } from '../spell-evaluator.js';
import { spellsForBreed } from '../spell-selection.js';
import {
  canonicalT1ContextIsUsable,
  spellsForCanonicalT1Context
} from '../combat-evaluation-context.js';
import {
  workshopBuildIsComplete,
  workshopCombatSignature,
  workshopItems
} from './workshop-build.js';

function clock() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function selectedSpellInputs(build, spellData) {
  const selected = new Set(build?.selectedSpells || []);
  return spellsForBreed(spellData, build?.classId)
    .filter((spell) => selected.has(spell.id) && (spell.hits || []).length > 0)
    .map((spell) => ({ enabled: true, weight: 1, spell, casts: { 1: 1, 2: 0, 3: 0 } }));
}

function currentCanonicalT1Context(build = {}, spellData = {}) {
  const context = build?.canonicalCombatContext;
  if (!canonicalT1ContextIsUsable(context)) return null;
  if (!build?.canonicalCombatSignature || build.canonicalCombatSignature !== workshopCombatSignature(build)) return null;
  const spells = spellsForCanonicalT1Context(context, spellData);
  if (spells.length !== context.spellIds.length) {
    return { invalid: true, context, spells: [] };
  }
  return { invalid: false, context, spells };
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
  const canonical = currentCanonicalT1Context(build, spellData);
  if (canonical?.invalid) {
    return {
      valid: false,
      reason: 'canonical-combat-context-unresolved',
      items,
      stats: null,
      activeSets: [],
      spells: [],
      combatSpells: [],
      complete: workshopBuildIsComplete(build),
      recalculationMs: Math.max(0, clock() - startedAt)
    };
  }

  const selections = canonical ? [] : selectedSpellInputs(build, spellData);
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
    scenario: {
      ...(canonical?.context?.scenario || scenario),
      requiredApByTurn: {}
    }
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

  const resolvedStats = canonical?.context?.stats || evaluation.result.stats;
  const resolvedStatsByTurn = canonical?.context?.effectiveStatsByTurn || evaluation.result.effectiveStatsByTurn || {};
  const stats = resolvedStatsByTurn?.[1] || resolvedStats;
  const classSpells = build?.classId ? spellsForBreed(spellData, build.classId) : [];
  const spells = classSpells
    .filter((spell) => (spell.hits || []).length > 0)
    .map((spell) => ({ spell, evaluation: evaluateSpell(spell, stats, { turn: 1 }) }))
    .filter((entry) => entry.evaluation.supported);

  return {
    valid: true,
    reason: null,
    items,
    stats: resolvedStats,
    effectiveStats: stats,
    effectiveStatsByTurn: resolvedStatsByTurn,
    activeSets: evaluation.result.activeSets || [],
    characteristics: evaluation.result.characteristics,
    fm: canonical?.context?.fm || evaluation.result.fm,
    spells,
    combatSpells: canonical?.spells || classSpells.filter((spell) => spell?.combatRelevant !== false),
    canonicalCombatContext: canonical?.context || null,
    combatEvaluationSource: canonical ? 'optimizer-canonical-t1' : 'workshop',
    complete: workshopBuildIsComplete(build),
    recalculationMs: Math.max(0, clock() - startedAt)
  };
}
