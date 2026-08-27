import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeSearchQuery } from '../js/search-query.js';
import {
  MemorySearchStore,
  SearchRepository,
  seedBuildsFromNearby
} from '../js/search-repository.js';
import { evaluateSearchSeeds } from '../js/search-seeds.js';

function item(id, slot, stats = {}) {
  return { id, name: id, slot, level: 200, stats, passives: [], conditions: null, certified: true };
}

const sharedRing = item('shared-ring', 'ring');
const items = [
  item('hat', 'hat'), item('cape', 'cape', { ap: 1 }), item('amulet', 'amulet', { ap: 1 }),
  sharedRing, sharedRing, item('belt', 'belt'), item('boots', 'boots', { mp: 1 }),
  item('weapon', 'weapon', { ap: 1 }), item('shield', 'shield'), item('companion', 'companion'),
  item('dofus-ap', 'dofus', { ap: 1 }), item('dofus-mp', 'dofus', { mp: 1 }),
  item('dofus-3', 'dofus'), item('dofus-4', 'dofus'), item('dofus-5', 'dofus'), item('dofus-6', 'dofus')
];
const catalog = [...new Map(items.map((entry) => [entry.id, entry])).values()];
const versions = { dataVersion: 'data-v1', rulesVersion: 'rules-v1', searchVersion: 'search-v1' };

function query(vit = 0) {
  return normalizeSearchQuery({
    classId: 'iop',
    combatObjective: { element: 'earth', turnMode: 't1', targetMode: 'single', metric: 'total-damage' },
    constraints: { ap: 12, mp: 6, vit },
    fmPolicy: { spellDamagePct: 0, allowCritDamage: false, structuralExos: false },
    scenario: { requiredApByTurn: {} },
    diversityMode: 'gear', searchProfile: 'BALANCED', turnMode: 't1', topN: 10
  }, versions);
}

test('cache exact et seeds préservent deux occurrences du même ID équipement', async () => {
  const store = new MemorySearchStore();
  const repository = new SearchRepository({ store });
  const sourceQuery = query(1000);
  await repository.save(sourceQuery, { results: [{ items, score: 100 }], diagnostics: {} });

  const exact = await repository.findExact(sourceQuery, { items: catalog });
  assert.equal(exact.hit, true);
  assert.equal(exact.output.results[0].items.filter((entry) => entry.id === 'shared-ring').length, 2);

  const nearby = await repository.findNearby(query(1100));
  const seeds = seedBuildsFromNearby(nearby);
  assert.equal(seeds.length, 1);
  assert.equal(seeds[0].itemIds.filter((id) => id === 'shared-ring').length, 2);

  const evaluated = evaluateSearchSeeds({
    seedBuilds: seeds,
    payload: {
      items: catalog,
      sets: [], selections: [], constraints: { ap: 12, mp: 6 },
      fmPolicy: { spellDamagePct: 0, allowCritDamage: false, structuralExos: false },
      turnMode: 't1', scenario: {}, requiredItemIds: []
    }
  });
  assert.equal(evaluated.diagnostics.valid, 1);
  assert.equal(evaluated.results[0].items.filter((entry) => entry.id === 'shared-ring').length, 2);
});
