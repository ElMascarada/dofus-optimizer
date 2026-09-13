import assert from 'node:assert/strict';
import test from 'node:test';

import { boundedCorePools } from '../optimizer/combined-set-core-search.js';

test('bounded core pool keeps the semantic union of per-set reserves beyond the historical 95 trim', () => {
  const cores = [];
  for (let setIndex = 0; setIndex < 60; setIndex++) {
    for (let variant = 0; variant < 2; variant++) {
      const rank = 1000 - (setIndex * 2 + variant);
      cores.push({
        id: `core-${setIndex}-${variant}`,
        setId: `set-${setIndex}`,
        pieceCount: 3,
        legality: { valid: true },
        searchStats: { power: rank },
        aggregateStats: { power: rank },
        items: []
      });
    }
  }

  const policy = {
    setCoreCatalog: { cores },
    rankStats(stats = {}) {
      const score = Number(stats.power || 0);
      return {
        rankScore: score,
        objectiveGain: score,
        meanGain: score,
        constraintSignal: 0,
        syntheticOffense: null
      };
    }
  };

  const pools = boundedCorePools(policy, ['fire', 'water']);
  const core3 = pools.get(3) || [];
  const ids = new Set(core3.map((core) => core.id));

  assert.equal(core3.length, 120, 'all explicitly reserved per-set lineages survive the pool boundary');
  assert.equal(ids.has('core-59-0'), true, 'low-ranked first reserve for the last set survives');
  assert.equal(ids.has('core-59-1'), true, 'low-ranked second reserve for the last set survives');
});
