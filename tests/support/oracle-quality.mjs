import { searchArchitecturesV2 } from '../../js/architecture-search-v2.js';
import { canonicalBuildKey, runExhaustiveOracle } from './exhaustive-oracle.mjs';

function scoreOf(build) {
  const score = Number(build?.score);
  return Number.isFinite(score) ? score : null;
}

function almostEqual(a, b, epsilon = 1e-9) {
  if (a === null || b === null) return a === b;
  const scale = Math.max(1, Math.abs(a), Math.abs(b));
  return Math.abs(a - b) <= epsilon * scale;
}

function itemSummary(item) {
  return {
    id: String(item?.id ?? ''),
    name: item?.name || String(item?.id ?? ''),
    slot: item?.slot || null
  };
}

function differentItems(oracleBuild, heuristicBuild) {
  const oracleItems = new Map((oracleBuild?.items || []).map((item) => [String(item.id), item]));
  const heuristicItems = new Map((heuristicBuild?.items || []).map((item) => [String(item.id), item]));
  return {
    oracleOnly: [...oracleItems.entries()]
      .filter(([id]) => !heuristicItems.has(id))
      .map(([, item]) => itemSummary(item)),
    heuristicOnly: [...heuristicItems.entries()]
      .filter(([id]) => !oracleItems.has(id))
      .map(([, item]) => itemSummary(item))
  };
}

function apparentCause({ oracleBuild, heuristicBuild, heuristicOutput, exactOptimal, exactMatch }) {
  if (!oracleBuild) return 'oracle-no-valid-build';
  if (!heuristicBuild) return 'heuristic-no-result';
  if (exactMatch) return 'none';
  if (exactOptimal) return 'score-tie-different-build';

  const retainedIds = new Set((heuristicOutput?.candidateItems || []).map((item) => String(item.id)));
  const missingOracleIds = (oracleBuild.items || [])
    .map((item) => String(item.id))
    .filter((id) => !retainedIds.has(id));
  return missingOracleIds.length
    ? 'candidate-pool-removed-oracle-item'
    : 'search-or-evaluation-budget-missed-oracle-build';
}

export function compareHeuristicToOracle({
  name = 'unnamed',
  items = [],
  sets = [],
  slots,
  constraints = {},
  selections = [],
  fmPolicy = {},
  turnMode = 'sum',
  scenario = {},
  topN = 10,
  maxCombinations,
  searchProfile = 'BALANCED',
  epsilon = 1e-9
} = {}) {
  const oracle = runExhaustiveOracle({
    items,
    sets,
    slots,
    constraints,
    selections,
    fmPolicy,
    turnMode,
    scenario,
    topN,
    maxCombinations
  });

  const heuristicOutput = searchArchitecturesV2({
    items,
    sets,
    selections,
    constraints,
    fmPolicy,
    turnMode,
    scenario,
    topN,
    searchProfile
  });

  const oracleBestBuild = oracle.bestBuild;
  const heuristicBestBuild = heuristicOutput?.results?.[0] ?? null;
  const oracleBestScore = scoreOf(oracleBestBuild);
  const heuristicBestScore = scoreOf(heuristicBestBuild);
  const exactOptimal = almostEqual(oracleBestScore, heuristicBestScore, epsilon);
  const exactMatch = exactOptimal
    && canonicalBuildKey(oracleBestBuild).length > 0
    && canonicalBuildKey(oracleBestBuild) === canonicalBuildKey(heuristicBestBuild);

  let absoluteGap = null;
  let relativeGapPct = null;
  let qualityRatio = null;
  if (oracleBestScore !== null) {
    if (heuristicBestScore === null) {
      absoluteGap = Math.abs(oracleBestScore);
      relativeGapPct = oracleBestScore === 0 ? 0 : 100;
      qualityRatio = oracleBestScore === 0 ? 1 : 0;
    } else {
      absoluteGap = Math.abs(oracleBestScore - heuristicBestScore);
      relativeGapPct = oracleBestScore === 0 ? (absoluteGap === 0 ? 0 : Infinity) : absoluteGap / Math.abs(oracleBestScore) * 100;
      qualityRatio = oracleBestScore === 0 ? (heuristicBestScore === 0 ? 1 : null) : heuristicBestScore / oracleBestScore;
    }
  }

  const diff = differentItems(oracleBestBuild, heuristicBestBuild);
  return {
    scenario: name,
    oracleBestScore,
    heuristicBestScore,
    absoluteGap,
    relativeGapPct,
    qualityRatio,
    exactMatch,
    exactOptimal,
    oracleBestBuild,
    heuristicBestBuild,
    differentItems: diff,
    apparentCause: apparentCause({
      oracleBuild: oracleBestBuild,
      heuristicBuild: heuristicBestBuild,
      heuristicOutput,
      exactOptimal,
      exactMatch
    }),
    oracle,
    heuristicDiagnostics: heuristicOutput?.diagnostics || null
  };
}

export function oracleQualitySummary(comparison) {
  return {
    scenario: comparison.scenario,
    combinations: comparison.oracle.combinations,
    legal: comparison.oracle.legal,
    constraintValid: comparison.oracle.constraintValid,
    oracleScore: comparison.oracleBestScore,
    heuristicScore: comparison.heuristicBestScore,
    qualityRatio: comparison.qualityRatio,
    exactOptimal: comparison.exactOptimal,
    exactMatch: comparison.exactMatch,
    apparentCause: comparison.apparentCause,
    oracleDurationMs: Number(comparison.oracle.durationMs.toFixed(3)),
    oracleBuild: (comparison.oracleBestBuild?.items || []).map((item) => String(item.id)).sort(),
    heuristicBuild: (comparison.heuristicBestBuild?.items || []).map((item) => String(item.id)).sort(),
    differentItems: comparison.differentItems
  };
}

export function oracleQualityLine(comparison) {
  return `ORACLE_QUALITY ${JSON.stringify(oracleQualitySummary(comparison))}`;
}
