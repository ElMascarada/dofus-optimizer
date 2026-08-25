import { searchArchitecturesV2 } from './architecture-search-v2.js';
import { refineOffensiveSlots } from './offensive-slot-refiner.js';
import { refineCombatTurns } from './combat-turn-refiner.js';
import { buildCombatFeedbackSelections, preferCompanionVitalityOnTies } from './combat-feedback.js';
import { diversifyBuilds } from './result-diversity.js';

const IGNORED_COMPLEX_DOFUS_PASSIVES = [
  'deep-purple',
  'turquoise-blue',
  'vermilion-red',
  'yellow-ochre',
  'descent-to-abyss'
];

const DIVERSITY_MODES = new Set(['score', 'prysma', 'gear', 'gear-4']);

function activeTurns(turnMode) {
  if (turnMode === 't1') return [1];
  if (turnMode === 't2') return [2];
  if (turnMode === 't3') return [3];
  return [1, 2, 3];
}

function isMultiTurnMode(turnMode) {
  return ['sum', 'average', 'min'].includes(String(turnMode || ''));
}

function selectionsForTurnMode(selections = [], turnMode = 'sum') {
  const allowed = new Set(activeTurns(turnMode));
  return (selections || []).map((selection) => ({
    ...selection,
    casts: {
      1: allowed.has(1) ? Number(selection.casts?.[1] || 0) : 0,
      2: allowed.has(2) ? Number(selection.casts?.[2] || 0) : 0,
      3: allowed.has(3) ? Number(selection.casts?.[3] || 0) : 0
    }
  }));
}

function spellMatchesElement(spell, element = 'multi') {
  if (element === 'multi' || !element) return Array.isArray(spell?.hits) && spell.hits.length > 0;
  return (spell?.hits || []).some((hit) => hit?.element === element);
}

function combatSpellPool(classSpells = [], combatObjective = {}) {
  const element = combatObjective.element || 'multi';
  return (classSpells || []).filter((spell) => {
    const support = (Array.isArray(spell?.combatModifiers) && spell.combatModifiers.length > 0)
      || (Array.isArray(spell?.delayedCombatModifiers) && spell.delayedCombatModifiers.length > 0)
      || Boolean(spell?.selfCharge);
    return support || spellMatchesElement(spell, element);
  });
}

function combatGearSelections(classSpells = [], combatObjective = {}) {
  const turns = new Set(activeTurns(combatObjective.turnMode || 't1'));
  const element = combatObjective.element || 'multi';
  return (classSpells || [])
    .filter((spell) => spellMatchesElement(spell, element))
    .map((spell) => ({
      spell: { ...spell },
      enabled: true,
      weight: 1,
      casts: {
        1: turns.has(1) ? 1 : 0,
        2: turns.has(2) ? 1 : 0,
        3: turns.has(3) ? 1 : 0
      }
    }));
}

function scenarioForUi(scenario = {}, turnMode = 'sum') {
  const allowed = new Set(activeTurns(turnMode));
  const requiredApByTurn = {};
  for (const turn of [1, 2, 3]) {
    if (allowed.has(turn)) requiredApByTurn[turn] = Number(scenario?.requiredApByTurn?.[turn] || 0);
  }
  return {
    ...scenario,
    requiredApByTurn,
    ignoredPassiveIds: [
      ...new Set([...(scenario.ignoredPassiveIds || []), ...IGNORED_COMPLEX_DOFUS_PASSIVES])
    ]
  };
}

function resultKey(result) {
  return (result?.items || []).map((item) => String(item.id)).sort().join('|');
}

function mergeOutputs(primary, fallback, topN) {
  const seen = new Map();
  for (const result of [...(primary?.results || []), ...(fallback?.results || [])]) {
    const key = resultKey(result);
    const previous = seen.get(key);
    if (!previous || result.score > previous.score) seen.set(key, result);
  }
  const merged = [...seen.values()].sort((a, b) => b.score - a.score).slice(0, topN);
  return {
    ...(primary || {}),
    results: merged,
    diagnostics: {
      ...(primary?.diagnostics || {}),
      fallbackUsed: Boolean(fallback),
      fallbackValid: Number(fallback?.diagnostics?.valid || 0),
      fallbackEvaluated: Number(fallback?.diagnostics?.evaluated || 0)
    }
  };
}

function mergeBuildCandidates(groups = [], limit = 60) {
  const seen = new Map();
  for (const group of groups) {
    for (const build of group || []) {
      const key = resultKey(build);
      const previous = seen.get(key);
      if (!previous || Number(build.score || 0) > Number(previous.score || 0)) seen.set(key, build);
    }
  }
  return [...seen.values()].slice(0, Math.max(1, Number(limit || 60)));
}

function normalizedRequiredIds(payload = {}) {
  return [...new Set((payload?.requiredItemIds || []).map(String).filter(Boolean))];
}

function buildHasRequiredItems(build, requiredIds = []) {
  if (!requiredIds.length) return true;
  const equipped = new Set((build?.items || []).map((item) => String(item.id)));
  return requiredIds.every((id) => equipped.has(String(id)));
}

function keepRequiredBuilds(builds = [], requiredIds = []) {
  return (builds || []).filter((build) => buildHasRequiredItems(build, requiredIds));
}

function diversityModeFor(payload = {}) {
  const mode = String(payload?.diversityMode || 'gear');
  return DIVERSITY_MODES.has(mode) ? mode : 'gear';
}

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'optimize') return;
  const { requestId, payload } = event.data;

  try {
    const combatMode = payload?.objectiveMode === 'combat';
    const combatObjective = payload?.combatObjective || {};
    const turnMode = combatMode ? (combatObjective.turnMode || payload?.turnMode || 't1') : (payload?.turnMode || 'sum');
    const multiTurn = combatMode && isMultiTurnMode(turnMode);
    const diversityMode = diversityModeFor(payload);
    const requiredIds = normalizedRequiredIds(payload);
    const combatSpells = combatMode ? combatSpellPool(payload?.classSpells || [], combatObjective) : [];
    const rawSelections = combatMode
      ? combatGearSelections(combatSpells, combatObjective)
      : payload?.selections;
    const selections = selectionsForTurnMode(rawSelections, turnMode);
    const scenario = scenarioForUi(payload?.scenario, turnMode);
    const enabledSpellCount = selections.filter((selection) => selection.enabled).length;

    if (combatMode || enabledSpellCount <= 1) scenario.requiredApByTurn = {};

    if (combatMode && !selections.length) {
      throw new Error(`Aucun sort offensif ${combatObjective.element || 'multi'} certifié pour cette classe.`);
    }

    const normalizedPayload = {
      ...payload,
      requiredItemIds: requiredIds,
      items: preferCompanionVitalityOnTies(payload?.items || []),
      selections,
      turnMode,
      scenario,
      fmPolicy: { ...payload?.fmPolicy, structuralExos: false }
    };

    const requestedTopN = Math.max(1, Number(payload?.topN || 10));
    const diversifiedSearch = diversityMode !== 'score';
    const searchTopN = combatMode
      ? Math.max(diversifiedSearch ? 90 : 60, requestedTopN * (diversifiedSearch ? 9 : 6))
      : diversifiedSearch ? Math.max(50, requestedTopN * 5) : requestedTopN;
    const primary = searchArchitecturesV2({
      ...normalizedPayload,
      topN: searchTopN,
      onProgress: (progress) => self.postMessage({ type: 'progress', requestId, progress })
    });

    let output = primary;

    if ((primary.results || []).length < searchTopN && !primary.diagnostics?.impossible) {
      const requiredSet = new Set(requiredIds);
      const conditionlessItems = (normalizedPayload.items || []).filter((item) => !item.conditions || requiredSet.has(String(item.id)));
      const fallback = searchArchitecturesV2({
        ...normalizedPayload,
        items: conditionlessItems,
        topN: searchTopN,
        onProgress: (progress) => {
          self.postMessage({
            type: 'progress',
            requestId,
            progress: { ...progress, label: `fallback légal · ${progress.label || ''}` }
          });
        }
      });
      output = mergeOutputs(primary, fallback, searchTopN);
    }

    output.results = keepRequiredBuilds(output.results, requiredIds);

    if (output.results?.length) {
      const beforeRefine = output.results;
      const refined = refineOffensiveSlots({
        ...normalizedPayload,
        results: beforeRefine,
        topN: searchTopN,
        preservePrysmaradites: combatMode || diversityMode === 'prysma',
        onProgress: (progress) => self.postMessage({ type: 'progress', requestId, progress })
      });
      output = {
        ...output,
        results: keepRequiredBuilds(mergeBuildCandidates([refined.results, beforeRefine], searchTopN), requiredIds),
        diagnostics: {
          ...(output.diagnostics || {}),
          offensiveRefine: refined.diagnostics
        }
      };
    }

    if (combatMode && output.results?.length) {
      const feedbackPlanCount = multiTurn
        ? Math.min(searchTopN, Math.max(20, requestedTopN * 2))
        : Math.min(searchTopN, Math.max(50, requestedTopN * 5));
      const firstCombat = refineCombatTurns({
        results: output.results,
        spells: combatSpells,
        combatObjective: { ...combatObjective, turnMode },
        topN: feedbackPlanCount,
        preservePrysmaradites: true,
        onProgress: (progress) => self.postMessage({ type: 'progress', requestId, progress })
      });
      firstCombat.results = keepRequiredBuilds(firstCombat.results, requiredIds);

      const feedbackSelections = buildCombatFeedbackSelections({
        results: firstCombat.results,
        spells: combatSpells,
        turnMode,
        maxPlans: multiTurn ? 8 : 10
      });

      let finalCandidates = firstCombat.results;
      let feedbackDiagnostics = { selections: feedbackSelections.length, refined: 0 };

      if (feedbackSelections.length) {
        const feedbackTopN = multiTurn
          ? Math.min(searchTopN, Math.max(30, requestedTopN * 3))
          : Math.min(searchTopN, Math.max(60, requestedTopN * 6));
        const feedbackRefined = refineOffensiveSlots({
          ...normalizedPayload,
          selections: feedbackSelections,
          results: firstCombat.results,
          topN: feedbackTopN,
          preservePrysmaradites: true,
          onProgress: (progress) => self.postMessage({
            type: 'progress',
            requestId,
            progress: { ...progress, label: `raffinage sur combo réel · ${progress.label || ''}` }
          })
        });
        feedbackDiagnostics = {
          selections: feedbackSelections.length,
          ...feedbackRefined.diagnostics
        };
        const mergeLimit = multiTurn
          ? Math.min(searchTopN, Math.max(36, requestedTopN * 4))
          : Math.min(searchTopN, Math.max(70, requestedTopN * 7));
        finalCandidates = keepRequiredBuilds(mergeBuildCandidates([
          feedbackRefined.results,
          firstCombat.results
        ], mergeLimit), requiredIds);
      }

      const finalBenchCount = multiTurn
        ? (diversityMode === 'score'
            ? requestedTopN
            : Math.min(searchTopN, Math.max(30, requestedTopN * 3)))
        : (diversityMode === 'score'
            ? requestedTopN
            : Math.min(searchTopN, Math.max(60, requestedTopN * 6)));
      const combat = refineCombatTurns({
        results: finalCandidates,
        spells: combatSpells,
        combatObjective: { ...combatObjective, turnMode },
        topN: finalBenchCount,
        preservePrysmaradites: diversityMode === 'prysma',
        onProgress: (progress) => self.postMessage({ type: 'progress', requestId, progress })
      });
      combat.results = keepRequiredBuilds(combat.results, requiredIds);
      const diversified = diversifyBuilds(combat.results, diversityMode, requestedTopN);
      output = {
        ...output,
        results: diversified,
        diagnostics: {
          ...(output.diagnostics || {}),
          requiredItemIds: requiredIds,
          combatFeedback: feedbackDiagnostics,
          resultDiversity: {
            mode: diversityMode,
            candidates: combat.results.length,
            returned: diversified.length
          },
          combatRefine: {
            ...combat.diagnostics,
            spellPool: combatSpells.length,
            element: combatObjective.element || 'multi',
            turnMode
          }
        }
      };
    } else if (output.results?.length) {
      const diversified = diversifyBuilds(keepRequiredBuilds(output.results, requiredIds), diversityMode, requestedTopN);
      output.results = diversified;
      output.diagnostics = {
        ...(output.diagnostics || {}),
        requiredItemIds: requiredIds,
        resultDiversity: {
          mode: diversityMode,
          candidates: Math.min(searchTopN, output.results.length),
          returned: diversified.length
        }
      };
    }

    output.results = keepRequiredBuilds(output.results, requiredIds);
    self.postMessage({ type: 'result', requestId, output });
  } catch (error) {
    self.postMessage({
      type: 'error',
      requestId,
      message: error instanceof Error ? error.message : String(error)
    });
  }
});
