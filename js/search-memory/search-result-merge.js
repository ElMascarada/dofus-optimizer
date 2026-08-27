import { diversifyBuilds } from '../result-diversity.js';

function resultKey(result = {}) {
  return (result.items || []).map((item) => String(item?.id || '')).filter(Boolean).sort().join('|');
}

export function mergeSearchOutputs(primary = {}, seeds = {}, {
  topN = 10,
  diversityMode = 'gear',
  fingerprint = '',
  nearbyRecords = 0
} = {}) {
  const byBuild = new Map();
  for (const result of [...(primary.results || []), ...(seeds.results || [])]) {
    const key = resultKey(result);
    if (!key) continue;
    const previous = byBuild.get(key);
    if (!previous || Number(result.score || 0) > Number(previous.score || 0)) byBuild.set(key, result);
  }
  const ranked = [...byBuild.values()].sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
  const requestedTopN = Math.max(1, Number(topN || 10));
  const results = diversifyBuilds(ranked, diversityMode, requestedTopN);
  const seedKeys = new Set((seeds.results || []).map(resultKey).filter(Boolean));
  const seedReturned = results.filter((result) => seedKeys.has(resultKey(result))).length;
  const seedEvaluation = seeds?.diagnostics?.seedEvaluation || {};

  return {
    ...primary,
    results,
    diagnostics: {
      ...(primary.diagnostics || {}),
      searchMemory: {
        cacheHit: false,
        fingerprint: String(fingerprint || ''),
        nearbyRecords: Number(nearbyRecords || 0),
        seedsAttempted: Number(seedEvaluation.attempted || 0),
        seedsValid: Number(seedEvaluation.valid || 0),
        seedsReturned: seedReturned,
        seedRejected: { ...(seedEvaluation.rejected || {}) }
      }
    }
  };
}

export function withExactCacheDiagnostics(output = {}, { fingerprint = '' } = {}) {
  return {
    ...output,
    diagnostics: {
      ...(output.diagnostics || {}),
      searchMemory: {
        cacheHit: true,
        fingerprint: String(fingerprint || ''),
        nearbyRecords: 0,
        seedsAttempted: 0,
        seedsValid: 0,
        seedsReturned: 0,
        seedRejected: {}
      }
    }
  };
}
