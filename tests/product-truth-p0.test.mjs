import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { itemConditionsAreValid } from '../js/build-legality.js';
import { applyCuratedSpellRules } from '../js/curated-runtime-rules.js';
import {
  MemorySearchStore,
  SearchMemoryRepository
} from '../js/search-memory/search-repository.js';
import { spellExpectedDamage } from '../js/spells.js';

const appSource = readFileSync(new URL('../js/optimizer-v2-app.js', import.meta.url), 'utf8');
const spellTruth = JSON.parse(readFileSync(new URL('../data/normalized/spell-source-truth.json', import.meta.url), 'utf8'));
const runtimeSpells = JSON.parse(readFileSync(new URL('../data/normalized/spell-data.json', import.meta.url), 'utf8'));
const dofusData = JSON.parse(readFileSync(new URL('../data/normalized/dofus-data.json', import.meta.url), 'utf8'));

const FIXED_DAMAGE_EFFECT_IDS = new Set([91, 92, 93, 94, 95, 96, 97, 98, 99, 100]);

function normalizedName(value = '') {
  return String(value).normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

function compactItem(item = {}) {
  return Object.fromEntries(Object.entries(item).filter(([key]) =>
    /^(id|ankamaId|name|slot|stats|conditions|condition|restrictions|setId|parentSetId|set|effects|passives|certified|staticOnly)$/i.test(key)
  ));
}

function abolitionTruth() {
  const source = (spellTruth.spells || []).find((spell) => Number(spell?.id) === 32453);
  const runtime = (runtimeSpells.spells || []).find((spell) => Number(spell?.ankamaId) === 32453);
  assert.ok(source, 'Flèche d\'Abolition 32453 absente de spell-source-truth.json');
  assert.ok(runtime, 'Flèche d\'Abolition 32453 absente de spell-data.json');
  return { source, runtime };
}

function immediateDamageEffects(effects = []) {
  return effects.filter((effect) => FIXED_DAMAGE_EFFECT_IDS.has(Number(effect?.effectId))
    && String(effect?.triggers ?? 'I') === 'I'
    && Number(effect?.duration || 0) === 0
    && Number(effect?.delay || 0) === 0
    && Number(effect?.random || 0) === 0);
}

function isAbolitionNormalTargetLine(effect = {}) {
  const targetMask = String(effect?.targetMask || '');
  return targetMask.includes('*e7120') && targetMask.includes('*e7121');
}

test('product search ignores stale memory and calls the Worker for identical searches', async () => {
  assert.match(appSource, /const searchMemory = new SearchMemoryRepository\(\);/);

  const item = { id: 'stale-item', name: 'Ancien résultat' };
  const query = {
    schemaVersion: 2,
    versions: { data: 'p0', rules: 'p0', search: 'p0' },
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
  console.log('MEMORY_PRODUCT_READS_DISABLED=YES');
  console.log('MEMORY_PRODUCT_WRITES_DISABLED=YES');
  console.log(`IDENTICAL_SEARCH_WORKER_CALL_COUNT=${workerCalls}`);
});

test('Flèche d\'Abolition keeps only normal-target damage lines from source truth', () => {
  const { source, runtime } = abolitionTruth();
  const rawHits = immediateDamageEffects(source.effects);
  const normalTargetHits = rawHits.filter(isAbolitionNormalTargetLine);
  const removedHits = rawHits.filter((effect) => !isAbolitionNormalTargetLine(effect));
  const normalTargetCrits = immediateDamageEffects(source.criticalEffects).filter(isAbolitionNormalTargetLine);
  const curated = applyCuratedSpellRules(runtime);

  assert.equal(rawHits.length, 6);
  assert.equal(normalTargetHits.length, 2);
  assert.equal(removedHits.length, 4);
  assert.equal(runtime.hits.length, 6);
  assert.equal(curated.hits.length, 2);
  assert.deepEqual(curated.hits.map((hit) => hit.normal), normalTargetHits.map((effect) => [effect.diceNum, effect.diceSide]));
  assert.deepEqual(curated.hits.map((hit) => hit.crit), normalTargetCrits.map((effect) => [effect.diceNum, effect.diceSide]));
  assert.equal(curated.curatedDamageRule, 'exclude-state-conditional-secondary-hits');

  console.log(`ABOLITION_RAW_HITS_BEFORE=${rawHits.length}`);
  console.log(`ABOLITION_NORMAL_TARGET_HITS_AFTER=${curated.hits.length}`);
  console.log(`ABOLITION_SUMMON_ONLY_HITS_REMOVED=${removedHits.length}`);
});

test('Flèche d\'Abolition flat damage scales only with normal-target hit count', () => {
  const { runtime } = abolitionTruth();
  const curated = applyCuratedSpellRules(runtime);
  const damage = 37;
  const baseline = spellExpectedDamage(curated, { crit: 0, damage }, 1);
  const plusOne = spellExpectedDamage(curated, { crit: 0, damage: damage + 1 }, 1);
  const delta = plusOne - baseline;

  assert.ok(Math.abs(delta - 2) <= 1e-9, `Expected +2 damage from +1 flat damage, got ${delta}`);
  console.log(`ABOLITION_FLAT_DAMAGE_DELTA=${delta}`);
});

test('Dofus Ocre structurally dominates Remueur for the same base build', () => {
  const ocre = (dofusData.items || []).find((item) => normalizedName(item?.name) === 'dofus ocre');
  const remueur = (dofusData.items || []).find((item) => normalizedName(item?.name) === 'remueur');
  assert.ok(ocre, 'Dofus Ocre absent du catalogue canonique');
  assert.ok(remueur, 'Remueur absent du catalogue canonique');

  assert.equal(Number(ocre.stats?.ap || 0), 1);
  assert.equal(Number(remueur.stats?.ap || 0), 1);
  assert.equal(ocre.setId ?? null, null);
  assert.equal(remueur.setId ?? null, null);
  assert.equal(ocre.conditions ?? null, null);
  assert.deepEqual(remueur.conditions, {
    kind: 'condition',
    stat: 'setBonus',
    operator: 'lt',
    value: 3,
    sourceName: 'Set bonus'
  });

  const feasibleBase = [
    { id: 'a1', setId: 'set-a' }, { id: 'a2', setId: 'set-a' },
    { id: 'b1', setId: 'set-b' }, { id: 'b2', setId: 'set-b' }
  ];
  assert.equal(itemConditionsAreValid([...feasibleBase, remueur], {}, 200), true);
  assert.equal(itemConditionsAreValid([...feasibleBase, ocre], {}, 200), true);

  const restrictedBase = [
    ...feasibleBase,
    { id: 'c1', setId: 'set-c' }, { id: 'c2', setId: 'set-c' }
  ];
  assert.equal(itemConditionsAreValid([...restrictedBase, remueur], {}, 200), false);
  assert.equal(itemConditionsAreValid([...restrictedBase, ocre], {}, 200), true);
  assert.equal(11 + Number(remueur.stats.ap), 11 + Number(ocre.stats.ap));

  console.log(`P0_OCRE=${JSON.stringify(compactItem(ocre))}`);
  console.log(`P0_REMUEUR=${JSON.stringify(compactItem(remueur))}`);
  console.log(`OCRE_AP=${Number(ocre.stats.ap)}`);
  console.log(`REMUEUR_AP=${Number(remueur.stats.ap)}`);
  console.log(`OCRE_CONDITIONS=${JSON.stringify(ocre.conditions ?? null)}`);
  console.log(`REMUEUR_CONDITIONS=${JSON.stringify(remueur.conditions ?? null)}`);
  console.log('REMUEUR_WITHOUT_OCRE_STRUCTURALLY_DOMINATED=YES');
});
