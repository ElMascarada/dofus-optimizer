import { evaluateSearchSeedBuilds } from './search-seeds.js';
import { refineCombatTurns } from '../combat-turn-refiner.js';

const IGNORED_COMPLEX_DOFUS_PASSIVES = Object.freeze([
  'deep-purple',
  'turquoise-blue',
  'vermilion-red',
  'yellow-ochre',
  'descent-to-abyss'
]);

function activeTurns(turnMode) {
  if (turnMode === 't1') return [1];
  if (turnMode === 't2') return [2];
  if (turnMode === 't3') return [3];
  return [1, 2, 3];
}

function spellMatchesElement(spell, element = 'multi') {
  if (element === 'multi' || !element) return Array.isArray(spell?.hits) && spell.hits.length > 0;
  return (spell?.hits || []).some((hit) => hit?.element === element);
}

function gearSelections(classSpells = [], combatObjective = {}) {
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

function scenarioForSeed(scenario = {}, turnMode = 'sum') {
  const allowed = new Set(activeTurns(turnMode));
  const requiredApByTurn = {};
  for (const turn of [1, 2, 3]) {
    if (allowed.has(turn)) requiredApByTurn[turn] = Number(scenario?.requiredApByTurn?.[turn] || 0);
  }
  return {
    ...scenario,
    requiredApByTurn: {},
    ignoredPassiveIds: [
      ...new Set([...(scenario.ignoredPassiveIds || []), ...IGNORED_COMPLEX_DOFUS_PASSIVES])
    ]
  };
}

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'evaluate-seeds') return;
  const { requestId, payload = {}, seedBuilds = [] } = event.data;
  try {
    const combatObjective = payload.combatObjective || {};
    const turnMode = combatObjective.turnMode || payload.turnMode || 't1';
    const scenario = scenarioForSeed(payload.scenario || {}, turnMode);
    const selections = payload.objectiveMode === 'combat'
      ? gearSelections(payload.classSpells || [], combatObjective)
      : (payload.selections || []);
    const evaluated = evaluateSearchSeedBuilds({
      seedBuilds,
      items: payload.items || [],
      sets: payload.sets || [],
      selections,
      constraints: payload.constraints || {},
      fmPolicy: payload.fmPolicy || {},
      turnMode,
      scenario
    });

    let results = evaluated.results;
    let combatDiagnostics = null;
    if (payload.objectiveMode === 'combat' && results.length) {
      const refined = refineCombatTurns({
        results,
        spells: payload.classSpells || [],
        combatObjective: { ...combatObjective, turnMode },
        topN: results.length,
        preservePrysmaradites: false,
        searchProfile: payload.searchProfile || 'BALANCED'
      });
      results = refined.results;
      combatDiagnostics = refined.diagnostics;
    }

    self.postMessage({
      type: 'seed-result',
      requestId,
      output: {
        results,
        diagnostics: {
          seedEvaluation: evaluated.diagnostics,
          combatRefine: combatDiagnostics
        }
      }
    });
  } catch (error) {
    self.postMessage({
      type: 'seed-error',
      requestId,
      message: error instanceof Error ? error.message : String(error)
    });
  }
});
