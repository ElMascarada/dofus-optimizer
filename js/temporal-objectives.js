export const TEMPORAL_TURNS = Object.freeze([1, 2, 3]);
export const TEMPORAL_MODE_IDS = Object.freeze(['t1', 't2', 't3', 'sum', 'average', 'min', 'constant']);

const TEMPORAL_MODE_SET = new Set(TEMPORAL_MODE_IDS);

function finiteDamage(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

export function isTemporalMode(mode) {
  return TEMPORAL_MODE_SET.has(String(mode || ''));
}

export function scoredTurnsForTemporalMode(mode = 't1') {
  const normalized = String(mode || 't1');
  if (normalized === 't1') return [1];
  if (normalized === 't2') return [2];
  if (normalized === 't3') return [3];
  return [...TEMPORAL_TURNS];
}

export function simulationTurnsForTemporalMode(mode = 't1') {
  const normalized = String(mode || 't1');
  if (normalized === 't2') return [1, 2];
  return scoredTurnsForTemporalMode(normalized);
}

// Compatibility alias with scoring semantics only. New planning code must choose
// explicitly between scoredTurnsForTemporalMode() and simulationTurnsForTemporalMode().
export function turnsForTemporalMode(mode = 't1') {
  return scoredTurnsForTemporalMode(mode);
}

export function constantTemporalScore(values = []) {
  const damages = (values || []).map(finiteDamage);
  if (!damages.length || damages.some((value) => value <= 0)) return 0;
  return damages.length / damages.reduce((sum, value) => sum + (1 / value), 0);
}

export function aggregateTemporalScore(perTurn = {}, mode = 'sum', activeTurns = null) {
  const turns = Array.isArray(activeTurns) && activeTurns.length
    ? activeTurns.map(Number).filter((turn) => TEMPORAL_TURNS.includes(turn))
    : scoredTurnsForTemporalMode(mode);
  const values = turns.map((turn) => finiteDamage(perTurn?.[turn]));
  if (!values.length) return 0;

  if (mode === 'sum') return values.reduce((sum, value) => sum + value, 0);
  if (mode === 'average') return values.reduce((sum, value) => sum + value, 0) / values.length;
  if (mode === 'min') return Math.min(...values);
  if (mode === 'constant') return constantTemporalScore(values);
  return values[0];
}

export function temporalObjectiveMetrics(perTurn = {}, activeTurns = TEMPORAL_TURNS) {
  const turns = (activeTurns || TEMPORAL_TURNS).map(Number).filter((turn) => TEMPORAL_TURNS.includes(turn));
  const values = turns.map((turn) => finiteDamage(perTurn?.[turn]));
  if (!values.length) {
    return { turns: [], sum: 0, average: 0, minimum: 0, maximum: 0, constant: 0 };
  }
  const sum = values.reduce((total, value) => total + value, 0);
  return {
    turns,
    sum,
    average: sum / values.length,
    minimum: Math.min(...values),
    maximum: Math.max(...values),
    constant: constantTemporalScore(values)
  };
}
