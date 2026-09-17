import assert from 'node:assert/strict';
import test from 'node:test';

import {
  boundedCorePools,
  contextualArchitectureCoreCandidates
} from '../optimizer/combined-set-core-search.js';

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

test('architecture expansion recovers one contextual third core without widening bounded pools', () => {
  const makeItem = (id, slot) => ({ id, name: id, slot, stats: {} });
  const targetCores = [
    {
      id: 'target-1', setId: 'target-set', pieceCount: 2, legality: { valid: true },
      searchStats: { searchScore: 30 }, aggregateStats: { searchScore: 30 },
      items: [makeItem('target-1-hat', 'hat'), makeItem('target-1-cape', 'cape')]
    },
    {
      id: 'target-2', setId: 'target-set', pieceCount: 2, legality: { valid: true },
      searchStats: { searchScore: 20 }, aggregateStats: { searchScore: 20 },
      items: [makeItem('target-2-ring', 'ring'), makeItem('target-2-boots', 'boots')]
    },
    {
      id: 'target-3', setId: 'target-set', pieceCount: 2, legality: { valid: true },
      searchStats: { searchScore: 10 }, aggregateStats: { searchScore: 10 },
      items: [makeItem('target-3-amulet', 'amulet'), makeItem('target-3-belt', 'belt')]
    }
  ];
  const decoys = Array.from({ length: 60 }, (_, index) => ({
    id: `decoy-${index}`,
    setId: `decoy-set-${index}`,
    pieceCount: 2,
    legality: { valid: true },
    searchStats: { searchScore: 1000 - index },
    aggregateStats: { searchScore: 1000 - index },
    items: [makeItem(`decoy-${index}-amulet`, 'amulet'), makeItem(`decoy-${index}-belt`, 'belt')]
  }));
  const policy = {
    setCoreCatalog: { cores: [...decoys, ...targetCores] },
    rankStats(stats = {}) {
      const score = Number(stats.searchScore || 0);
      return { rankScore: score, objectiveGain: score, meanGain: score, constraintSignal: 0, syntheticOffense: null };
    }
  };

  const pools = boundedCorePools(policy, []);
  const boundedTargetIds = (pools.get(2) || [])
    .filter((core) => core.setId === 'target-set')
    .map((core) => core.id);
  assert.deepEqual(boundedTargetIds, ['target-1', 'target-2'], 'bounded pool remains top-2 for the target set');

  const occupied = {
    cores: [{
      id: 'occupied-core',
      setId: 'occupied-set',
      items: [
        makeItem('occupied-hat', 'hat'),
        makeItem('occupied-ring-a', 'ring'),
        makeItem('occupied-ring-b', 'ring')
      ]
    }]
  };
  const candidates = contextualArchitectureCoreCandidates(occupied, 2, pools, { policy });
  const targetCandidateIds = candidates.filter((core) => core.setId === 'target-set').map((core) => core.id);

  assert.deepEqual(targetCandidateIds, ['target-3'], 'third-ranked distinct footprint is recovered only in the incompatible context');
  assert.equal((pools.get(2) || []).some((core) => core.id === 'target-3'), false, 'fallback is not appended to boundedCorePools');
});
