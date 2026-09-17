import test from 'node:test';
import assert from 'node:assert/strict';

import {
  compareCompleteEquipmentBuildResults,
  evaluateCompleteEquipmentBuild
} from '../js/complete-equipment-build-evaluator.js';
import { dofusPackages } from '../optimizer/combined-set-core-search.js';

function item(id, slot, stats = {}) {
  return { id, name: id, slot, stats, conditions: null, setId: null };
}

function completeBaseItems() {
  return [
    item('base-hat', 'hat'),
    item('base-cape', 'cape'),
    item('base-amulet', 'amulet'),
    item('base-ring-a', 'ring'),
    item('base-ring-b', 'ring'),
    item('base-belt', 'belt'),
    item('base-boots', 'boots'),
    item('base-weapon', 'weapon'),
    item('base-shield', 'shield'),
    item('base-companion', 'companion')
  ];
}

test('canonical evaluation can recover a package ranked below heuristic top-14', () => {
  const baseItems = completeBaseItems();
  const truth = Array.from({ length: 6 }, (_, index) => item(`truth-${index}`, 'dofus', {
    earth: 100,
    fire: 100,
    crit: 5
  }));
  const decoys = [
    item('decoy-a', 'dofus', { prospecting: 1000 }),
    item('decoy-b', 'dofus', { prospecting: 900 })
  ];
  const pool = [...truth, ...decoys];
  const policy = {
    rankStats(stats = {}) {
      const score = Number(stats.prospecting || 0);
      return {
        rankScore: score,
        objectiveGain: score,
        meanGain: score,
        constraintSignal: 0,
        syntheticOffense: null
      };
    }
  };
  const context = { policy, setsById: {}, fmPolicy: {}, constraints: {}, specialistKeys: [] };
  const packages = dofusPackages(baseItems, pool, context);
  const truthIds = new Set(truth.map((entry) => entry.id));
  const truthIndex = packages.findIndex((pack) => pack.items.every((entry) => truthIds.has(entry.id)));

  assert.equal(packages.length, 28, 'all legal six-of-eight beam survivors remain reachable');
  assert.ok(truthIndex >= 14, `truth package must start below heuristic top-14, got rank ${truthIndex + 1}`);

  const syntheticOffense = { elements: ['earth', 'fire'], profiles: ['large'], critMode: 'crit' };
  const character = { level: 200, characteristicPoints: 0, scrolled: {}, baseStats: { ap: 7, mp: 3 } };
  const evaluated = packages.map((pack, index) => ({
    index,
    result: evaluateCompleteEquipmentBuild({
      items: [...baseItems, ...pack.items],
      sets: [],
      constraints: {},
      fmPolicy: {},
      syntheticOffense,
      character
    }).result
  }));
  assert.ok(evaluated.every((entry) => entry.result), 'fixture packages must all be canonically legal');

  const truthResult = evaluated.find((entry) => entry.index === truthIndex).result;
  const bestHeuristicTop14 = [...evaluated.slice(0, 14)]
    .sort((a, b) => -compareCompleteEquipmentBuildResults(a.result, b.result))[0].result;
  const bestAll = [...evaluated]
    .sort((a, b) => -compareCompleteEquipmentBuildResults(a.result, b.result))[0].result;

  assert.ok(compareCompleteEquipmentBuildResults(truthResult, bestHeuristicTop14) > 0,
    'canonical evaluator must prefer the below-top-14 truth package');
  assert.equal(bestAll.buildIdentity, truthResult.buildIdentity,
    'canonical final selection must keep the true best package reachable');
});
