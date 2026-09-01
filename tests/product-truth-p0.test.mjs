import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  MemorySearchStore,
  SearchMemoryRepository
} from '../js/search-memory/search-repository.js';

const appSource = readFileSync(new URL('../js/optimizer-v2-app.js', import.meta.url), 'utf8');
const spellTruth = JSON.parse(readFileSync(new URL('../data/normalized/spell-source-truth.json', import.meta.url), 'utf8'));
const runtimeSpells = JSON.parse(readFileSync(new URL('../data/normalized/spell-data.json', import.meta.url), 'utf8'));
const dofusData = JSON.parse(readFileSync(new URL('../data/normalized/dofus-data.json', import.meta.url), 'utf8'));

function normalizedName(value = '') {
  return String(value).normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

function compactItem(item = {}) {
  return Object.fromEntries(Object.entries(item).filter(([key]) =>
    /^(id|ankamaId|name|slot|stats|conditions|condition|restrictions|setId|parentSetId|set|effects|passives|certified|staticOnly)$/i.test(key)
  ));
}

test('product search ignores stale memory and calls the Worker for identical searches', async () => {
  assert.match(appSource, /const searchMemory = new SearchMemoryRepository\(\);/);

  const item = { id: 'stale-item', name: 'Ancien résultat' };
  const query = {
    schemaVersion: 1,
    versions: { data: 'p0', spells: 'p0', rules: 'p0' },
    classId: 'cra',
    element: 'earth',
    constraints: { ap: 12, mp: 6 },
    turnMode: 't1'
  };
  const staleStore = new MemorySearchStore();
  const staleRepository = new SearchMemoryRepository({ store: staleStore });
  await staleRepository.remember(query, {
    results: [{ id: 'stale-build', score: 999999, items: [item] }],
    diagnostics: {}
  });
  const seeded = await staleRepository.recallExact(query, { items: [item] });
  assert.equal(seeded.hit, true);
  assert.equal(seeded.output.results[0].id, 'stale-build');

  const productRepository = new SearchMemoryRepository();
  let workerCalls = 0;
  async function runUserSearch() {
    const exact = await productRepository.recallExact(query, { items: [item] });
    if (exact.hit) return exact.output.results[0];
    const nearby = await productRepository.findNearby(query);
    assert.deepEqual(nearby, []);
    workerCalls += 1;
    const fresh = { id: `worker-build-${workerCalls}`, score: 10 + workerCalls, items: [item] };
    await productRepository.remember(query, { results: [fresh], diagnostics: {} });
    return fresh;
  }

  const first = await runUserSearch();
  const second = await runUserSearch();
  assert.equal(first.id, 'worker-build-1');
  assert.equal(second.id, 'worker-build-2');
  assert.equal(workerCalls, 2);
  assert.equal((await productRepository.store.getAll()).length, 0);

  console.log('STALE_MEMORY_USED=NO');
  console.log('WORKER_CALLED=YES');
  console.log(`IDENTICAL_SEARCH_WORKER_CALL_COUNT=${workerCalls}`);
});

test('diagnostic: expose exact Abolition source shape and Ocre/Remueur catalog truth', () => {
  const source = (spellTruth.spells || []).find((spell) => Number(spell?.id) === 32453);
  const runtime = (runtimeSpells.spells || []).find((spell) => Number(spell?.ankamaId) === 32453);
  assert.ok(source, 'Flèche d\'Abolition 32453 absente de spell-source-truth.json');
  assert.ok(runtime, 'Flèche d\'Abolition 32453 absente de spell-data.json');

  console.log(`P0_ABOLITION_SOURCE=${JSON.stringify({
    id: source.id,
    name: source.name,
    effects: source.effects,
    criticalEffects: source.criticalEffects,
    scripts: source.scripts,
    stateReferences: source.stateReferences,
    unresolvedReasons: source.unresolvedReasons
  })}`);
  console.log(`P0_ABOLITION_RUNTIME=${JSON.stringify({
    id: runtime.id,
    ankamaId: runtime.ankamaId,
    name: runtime.name,
    hits: runtime.hits,
    apCost: runtime.apCost
  })}`);

  const ocre = (dofusData.items || []).find((item) => normalizedName(item?.name) === 'dofus ocre');
  const remueur = (dofusData.items || []).find((item) => normalizedName(item?.name) === 'remueur');
  assert.ok(ocre, 'Dofus Ocre absent du catalogue canonique');
  assert.ok(remueur, 'Remueur absent du catalogue canonique');
  console.log(`P0_OCRE=${JSON.stringify(compactItem(ocre))}`);
  console.log(`P0_REMUEUR=${JSON.stringify(compactItem(remueur))}`);
});
