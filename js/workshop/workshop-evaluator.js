import { BASE_CHARACTER } from '../config.js';
import { evaluateCompleteBuild } from '../complete-build-evaluator.js';
import { evaluateCompleteEquipmentBuild } from '../complete-equipment-build-evaluator.js';
import { evaluateSpell } from '../spell-evaluator.js';
import { spellsForBreed } from '../spell-selection.js';
import { statsForTurnDetailed } from '../spells.js';
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

function t1DamageSources(items = [], staticStats = {}, scenario = {}) {
  const labels = new Map();
  for (const item of items) {
    for (const passive of item?.passives || []) labels.set(String(passive.id), passive.label || passive.id);
  }
  const detail = statsForTurnDetailed(staticStats, items, 1, scenario);
  return (detail.applied || [])
    .map((entry) => {
      const stats = { ...(entry.stats || {}) };
      const damageStats = Object.fromEntries(Object.entries(stats).filter(([key, value]) => Number(value || 0) !== 0 && [
        'finalDamagePct', 'spellDamagePct', 'weaponDamagePct', 'meleeDamagePct', 'rangedDamagePct',
        'power', 'earth', 'fire', 'water', 'air', 'damage', 'critDamage', 'crit'
      ].includes(key)));
      return {
        passiveId: entry.passiveId,
        label: labels.get(String(entry.passiveId)) || entry.passiveId,
        stats: damageStats
      };
    })
    .filter((entry) => Object.keys(entry.stats).length > 0);
}

function invalidResult({ startedAt, items, build, reason, workspaceContext = null, diagnostics = null } = {}) {
  return {
    valid: false,
    reason: reason || 'evaluation-failed',
    items,
    stats: null,
    activeSets: [],
    spells: [],
    combatSpells: [],
    complete: workshopBuildIsComplete(build),
    workspaceContext,
    workspaceDiagnostics: diagnostics,
    recalculationMs: Math.max(0, clock() - startedAt)
  };
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
  const workspaceContext = build?.workspaceContext || null;
  const complete = workshopBuildIsComplete(build);

  let resolvedStats;
  let resolvedStatsByTurn = {};
  let activeSets = [];
  let characteristics = null;
  let fm = null;
  let syntheticOffense = null;
  let evaluationSource = 'workshop';
  let canonical = null;
  let effectiveScenario = scenario;

  if (workspaceContext && complete) {
    const canonicalEquipment = evaluateCompleteEquipmentBuild({
      items,
      sets: dataset?.sets || [],
      constraints: workspaceContext.constraints || {},
      fmPolicy: workspaceContext.fmPolicy || build?.fmPolicy || {},
      syntheticOffense: workspaceContext.syntheticOffense || {},
      character
    });
    if (!canonicalEquipment.result) {
      return invalidResult({
        startedAt,
        items,
        build,
        reason: canonicalEquipment.reason || 'evaluation-failed',
        workspaceContext,
        diagnostics: canonicalEquipment.constraintDiagnostics
          || canonicalEquipment.legalityDiagnostics
          || canonicalEquipment.evaluationDiagnostics
          || null
      });
    }
    const result = canonicalEquipment.result;
    resolvedStats = result.stats;
    activeSets = result.activeSets || [];
    characteristics = result.characteristics || null;
    fm = result.fm || null;
    syntheticOffense = result.syntheticOffense || null;
    evaluationSource = 'optimizer-canonical-equipment';
  } else {
    canonical = currentCanonicalT1Context(build, spellData);
    if (canonical?.invalid) {
      return invalidResult({
        startedAt,
        items,
        build,
        reason: 'canonical-combat-context-unresolved'
      });
    }

    const selections = canonical ? [] : selectedSpellInputs(build, spellData);
    effectiveScenario = canonical?.context?.scenario || scenario;
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
        ...effectiveScenario,
        requiredApByTurn: {}
      }
    });

    if (!evaluation.result) {
      return invalidResult({
        startedAt,
        items,
        build,
        reason: evaluation.reason || 'evaluation-failed'
      });
    }

    resolvedStats = canonical?.context?.stats || evaluation.result.stats;
    resolvedStatsByTurn = canonical?.context?.effectiveStatsByTurn || evaluation.result.effectiveStatsByTurn || {};
    activeSets = evaluation.result.activeSets || [];
    characteristics = evaluation.result.characteristics;
    fm = canonical?.context?.fm || evaluation.result.fm;
    evaluationSource = canonical ? 'optimizer-canonical-t1' : 'workshop';
  }

  const effectiveT1Stats = resolvedStatsByTurn?.[1] || resolvedStats;
  const classSpells = build?.classId ? spellsForBreed(spellData, build.classId) : [];
  const spells = classSpells
    .filter((spell) => (spell.hits || []).length > 0)
    .map((spell) => {
      const staticEvaluation = evaluateSpell(spell, resolvedStats, { turn: 1 });
      const t1Evaluation = evaluateSpell(spell, effectiveT1Stats, { turn: 1 });
      return { spell, evaluation: t1Evaluation, staticEvaluation, t1Evaluation };
    })
    .filter((entry) => entry.staticEvaluation.supported || entry.t1Evaluation.supported);

  return {
    valid: true,
    reason: null,
    items,
    stats: resolvedStats,
    effectiveStats: effectiveT1Stats,
    effectiveStatsByTurn: resolvedStatsByTurn,
    activeSets,
    characteristics,
    fm,
    syntheticOffense,
    theoreticalDamage: Number.isFinite(Number(syntheticOffense?.minimumScore))
      ? Number(syntheticOffense.minimumScore)
      : null,
    workspaceContext,
    referenceScore: Number.isFinite(Number(workspaceContext?.referenceScore))
      ? Number(workspaceContext.referenceScore)
      : null,
    spells,
    t1DamageSources: t1DamageSources(items, resolvedStats, effectiveScenario),
    combatSpells: canonical?.spells || classSpells.filter((spell) => spell?.combatRelevant !== false),
    canonicalCombatContext: canonical?.context || null,
    combatEvaluationSource: evaluationSource,
    complete,
    recalculationMs: Math.max(0, clock() - startedAt)
  };
}
