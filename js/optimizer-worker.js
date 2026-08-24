import { searchArchitecturesV2 } from './architecture-search-v2.js';

// Context-heavy Dofus passives stay outside the automatic ranking until their
// combat context is explicitly modelled. Their fixed item stats remain usable.
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

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'optimize') return;
  const { requestId, payload } = event.data;

  try {
    const turnMode = payload?.turnMode || 'sum';
    const selections = selectionsForTurnMode(payload?.selections, turnMode);
    const scenario = scenarioForUi(payload?.scenario, turnMode);
    const normalizedPayload = {
      ...payload,
      selections,
      turnMode,
      scenario,
      // +1 PA/+1 PM are already included in BASE_CHARACTER. Every equipment
      // slot therefore remains available for offensive FM.
      fmPolicy: { ...payload?.fmPolicy, structuralExos: false }
    };

    const output = searchArchitecturesV2({
      ...normalizedPayload,
      onProgress: (progress) => {
        self.postMessage({ type: 'progress', requestId, progress });
      }
    });

    self.postMessage({ type: 'result', requestId, output });
  } catch (error) {
    self.postMessage({
      type: 'error',
      requestId,
      message: error instanceof Error ? error.message : String(error)
    });
  }
});
