import { searchArchitecturesV2 } from './architecture-search-v2.js';
import { refineOffensiveSlots } from './offensive-slot-refiner.js';
import { refineCombatTurns } from './combat-turn-refiner.js';

const IGNORED_COMPLEX_DOFUS_PASSIVES = [
  'deep-purple',
  'turquoise-blue',
  'vermilion-red',
  'yellow-ochre',
  'descent-to-abyss'
];

function activeTurns(turnMode) {
  if (turnMode === 't1') return [1];
  if (turnMode === 't2') return [2];
  if (turnMode === 't3') return [3];
  return [1, 2, 3];
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
    const support = Array.isArray(spell?.combatModifiers) && spell.combatModifiers.length > 0;
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

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'optimize') return;
  const { requestId, payload } = event.data;

  try {
    const combatMode = payload?.objectiveMode === 'combat';
    const combatObjective = payload?.combatObjective || {};
    const turnMode = combatMode ? (combatObjective.turnMode || payload?.turnMode || 't1') : (payload?.turnMode || 'sum');
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
      selections,
      turnMode,
      scenario,
      fmPolicy: { ...payload?.fmPolicy, structuralExos: false }
    };

    const requestedTopN = Math.max(1, Number(payload?.topN || 10));
    // The automatic mode deliberately keeps a wider equipment bench before the
    // sequence solver. A build that is only second-best on isolated hits may be
    // first once AP economy and class buffs are sequenced correctly.
    const searchTopN = combatMode ? Math.max(60, requestedTopN * 6) : requestedTopN;
    const primary = searchArchitecturesV2({
      ...normalizedPayload,
      topN: searchTopN,
      onProgress: (progress) => self.postMessage({ type: 'progress', requestId, progress })
    });

    let output = primary;

    if ((primary.results || []).length < searchTopN) {
      const conditionlessItems = (normalizedPayload.items || []).filter((item) => !item.conditions);
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

    if (output.results?.length) {
      const refined = refineOffensiveSlots({
        ...normalizedPayload,
        results: output.results,
        topN: searchTopN,
        onProgress: (progress) => self.postMessage({ type: 'progress', requestId, progress })
      });
      output = {
        ...output,
        results: refined.results,
        diagnostics: {
          ...(output.diagnostics || {}),
          offensiveRefine: refined.diagnostics
        }
      };
    }

    if (combatMode && output.results?.length) {
      const combat = refineCombatTurns({
        results: output.results,
        spells: combatSpells,
        combatObjective: { ...combatObjective, turnMode },
        topN: requestedTopN,
        onProgress: (progress) => self.postMessage({ type: 'progress', requestId, progress })
      });
      output = {
        ...output,
        results: combat.results,
        diagnostics: {
          ...(output.diagnostics || {}),
          combatRefine: { ...combat.diagnostics, spellPool: combatSpells.length, element: combatObjective.element || 'multi', turnMode }
        }
      };
    } else if (output.results?.length > requestedTopN) {
      output.results = output.results.slice(0, requestedTopN);
    }

    self.postMessage({ type: 'result', requestId, output });
  } catch (error) {
    self.postMessage({
      type: 'error',
      requestId,
      message: error instanceof Error ? error.message : String(error)
    });
  }
});
