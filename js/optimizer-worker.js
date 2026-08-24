import { searchArchitecturesV2 } from './architecture-search-v2.js';
import { applyPassiveModifiers } from './passives.js';
import { SLOT_RULES } from './config.js';

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

function itemPassivesResolve(item, scenario, turnMode) {
  const passives = item?.passives || [];
  if (!passives.length) return true;
  for (const turn of activeTurns(turnMode)) {
    const resolved = applyPassiveModifiers({}, passives, { ...scenario, turn });
    if (resolved.unresolved?.length) return false;
  }
  return true;
}

function safeItem(item, scenario, turnMode) {
  return !item?.conditions && itemPassivesResolve(item, scenario, turnMode);
}

function slotCoverage(items = []) {
  const counts = new Map();
  for (const item of items) counts.set(item.slot, (counts.get(item.slot) || 0) + 1);
  return SLOT_RULES.every((rule) => (counts.get(rule.id) || 0) >= Number(rule.count || 0));
}

function rejectionSummary(diagnostics = {}) {
  const rejected = diagnostics.rejected || {};
  const parts = Object.entries(rejected)
    .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))
    .map(([reason, count]) => `${reason}: ${Number(count || 0).toLocaleString('fr-FR')}`);
  const legal = Number(diagnostics.legalCandidates || 0).toLocaleString('fr-FR');
  const evaluated = Number(diagnostics.evaluated || diagnostics.nodes || 0).toLocaleString('fr-FR');
  return `${evaluated} évalués · ${legal} candidats 12/6${parts.length ? ` · ${parts.join(' · ')}` : ''}`;
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

    if (output.results?.length) {
      self.postMessage({ type: 'result', requestId, output });
      return;
    }

    // If every high-scoring architecture is rejected, retry with a deliberately
    // conservative pool: no item conditions and no unresolved passives. This
    // prevents one attractive conditional trophy/passive from poisoning all
    // top Dofus combinations while still keeping deterministic/ignored Dofus.
    const safeItems = (normalizedPayload.items || []).filter((item) => safeItem(item, scenario, turnMode));
    let safeOutput = null;
    if (slotCoverage(safeItems)) {
      safeOutput = searchArchitecturesV2({
        ...normalizedPayload,
        items: safeItems,
        onProgress: (progress) => {
          self.postMessage({
            type: 'progress',
            requestId,
            progress: { ...progress, label: `safe · ${progress.label || ''}` }
          });
        }
      });
    }

    if (safeOutput?.results?.length) {
      safeOutput.diagnostics = {
        ...safeOutput.diagnostics,
        safeFallback: true,
        primaryRejected: output.diagnostics?.rejected || {},
        primaryLegalCandidates: output.diagnostics?.legalCandidates || 0
      };
      self.postMessage({ type: 'result', requestId, output: safeOutput });
      return;
    }

    const primary = rejectionSummary(output.diagnostics);
    const safe = safeOutput
      ? rejectionSummary(safeOutput.diagnostics)
      : `pool sûr incomplet (${safeItems.length.toLocaleString('fr-FR')} items)`;
    self.postMessage({
      type: 'error',
      requestId,
      message: `Aucun stuff valide. Passe principale : ${primary}. Passe sûre : ${safe}.`
    });
  } catch (error) {
    self.postMessage({
      type: 'error',
      requestId,
      message: error instanceof Error ? error.message : String(error)
    });
  }
});
