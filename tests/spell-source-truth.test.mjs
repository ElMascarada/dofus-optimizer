import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const sourceTruthPath = new URL('../data/normalized/spell-source-truth.json', import.meta.url);
const runtimePath = new URL('../data/normalized/spell-data.json', import.meta.url);

async function readJson(url) {
  return JSON.parse(await readFile(url, 'utf8'));
}

function gitBlobSha(bytes) {
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

function spellById(artifact, id) {
  const spell = artifact.spells.find((entry) => entry.id === id);
  assert.ok(spell, `spell ${id} must exist in source truth`);
  return spell;
}

function effect(spell, effectId, order) {
  const row = spell.effects.find((entry) => entry.effectId === effectId && entry.order === order);
  assert.ok(row, `${spell.name}: effect ${effectId} order ${order} must be preserved`);
  return row;
}

function scriptIds(spell) {
  return spell.scripts.bound.map((entry) => entry.scriptId);
}

test('source truth artifact stays separate from the certified runtime combat catalog', async () => {
  const runtimeBytes = await readFile(runtimePath);
  assert.equal(gitBlobSha(runtimeBytes), 'fff4e51dd61ab8cfe67ea73d50ac15e1e7d37358');
  const artifact = await readJson(sourceTruthPath);
  assert.notEqual(sourceTruthPath.pathname, runtimePath.pathname);
  assert.ok(artifact.spells.length > 0);
  assert.ok(artifact.spells.every((spell) => spell.runtimeRepresentation.sourceTruthConsumedByRuntime === false));
});

test('coverage is internally coherent and reports the pinned source dataset', async () => {
  const artifact = await readJson(sourceTruthPath);
  const { coverage } = artifact;
  assert.equal(coverage.sourceSpellCount, 17067);
  assert.equal(coverage.entriesEmitted, artifact.spells.length);
  assert.equal(coverage.runtimeSupported + coverage.sourceUnresolved, coverage.entriesEmitted);
  assert.equal(coverage.withScripts, artifact.spells.filter((spell) => spell.scripts.bound.length).length);
  assert.equal(coverage.withTriggers, artifact.spells.filter((spell) => [...spell.effects, ...spell.criticalEffects].some((entry) => entry.triggers !== 'I')).length);
  assert.equal(coverage.withStates, artifact.spells.filter((spell) => spell.stateReferences.length).length);
  assert.equal(artifact.source.rawAssetCounts.spellPairs, 726);
  assert.equal(artifact.source.rawAssetCounts.spellScripts, 14929);
  assert.equal(artifact.source.rawAssetCounts.spellStates, 6375);
  assert.equal(artifact.source.rawAssetCounts.spellTypes, 3260);
  assert.equal(artifact.source.standaloneScriptMetadataJoin, 'source-unresolved');
});

test('Tirs Puissants preserves rich source truth without activating script semantics', async () => {
  const artifact = await readJson(sourceTruthPath);
  const spell = spellById(artifact, 32466);
  assert.equal(spell.name, 'Tirs Puissants');
  assert.equal(spell.breed.name, 'Crâ');
  assert.equal(spell.type.id, 9);
  assert.equal(spell.level.id, 86172);
  assert.equal(spell.level.grade, 3);
  assert.equal(spell.level.minPlayerLevel, 169);
  assert.equal(spell.level.apCost, 1);
  assert.deepEqual(scriptIds(spell), [18962]);
  assert.deepEqual([116, 138, 414, 115].map((id, order) => effect(spell, id, order).value), [3, 250, 150, 15]);
  assert.equal(spell.semanticStatus, 'source-unresolved');
  assert.ok(spell.unresolvedReasons.includes('bound-script-semantics-not-certified'));
  assert.equal(spell.runtimeRepresentation.sourceTruthConsumedByRuntime, false);
});

test('Crâ Sentinelle preserves non-immediate trigger, delays and bound scripts unresolved', async () => {
  const artifact = await readJson(sourceTruthPath);
  const spell = spellById(artifact, 32475);
  assert.equal(spell.name, 'Sentinelle');
  assert.equal(spell.breed.name, 'Crâ');
  assert.equal(spell.type.id, 594);
  assert.equal(spell.level.id, 85283);
  assert.equal(spell.level.grade, 1);
  assert.deepEqual(scriptIds(spell), [19012, 19011]);
  assert.equal(effect(spell, 2805, 6).triggers, 'CCMPARR');
  assert.equal(effect(spell, 116, 7).triggers, 'CCMPARR');
  assert.equal(effect(spell, 3793, 8).delay, 2);
  assert.equal(effect(spell, 406, 9).delay, 2);
  assert.equal(spell.semanticStatus, 'source-unresolved');
  assert.ok(spell.unresolvedReasons.includes('non-immediate-trigger-semantics-not-certified'));
  assert.ok(spell.unresolvedReasons.includes('delayed-effect-semantics-not-certified'));
  assert.equal(spell.runtimeRepresentation.sourceTruthConsumedByRuntime, false);
});

test('Tir Perçant preserves trigger D and leaves it inactive', async () => {
  const artifact = await readJson(sourceTruthPath);
  const spell = spellById(artifact, 32471);
  assert.equal(spell.name, 'Tir Perçant');
  assert.equal(spell.type.id, 594);
  assert.equal(spell.level.id, 86200);
  assert.equal(spell.level.grade, 2);
  assert.equal(spell.level.apCost, 1);
  assert.equal(spell.level.minRange, 1);
  assert.equal(spell.level.maxRange, 6);
  assert.deepEqual(scriptIds(spell), [18988]);
  assert.equal(effect(spell, 1163, 1).triggers, 'D');
  assert.equal(effect(spell, 406, 2).triggers, 'D');
  assert.equal(spell.semanticStatus, 'source-unresolved');
  assert.equal(spell.runtimeRepresentation.sourceTruthConsumedByRuntime, false);
});

test('Représailles preserves trigger D and leaves it inactive', async () => {
  const artifact = await readJson(sourceTruthPath);
  const spell = spellById(artifact, 32472);
  assert.equal(spell.name, 'Représailles');
  assert.equal(spell.type.id, 594);
  assert.equal(spell.level.id, 85280);
  assert.equal(spell.level.grade, 1);
  assert.equal(spell.level.apCost, 3);
  assert.equal(spell.level.minRange, 3);
  assert.equal(spell.level.maxRange, 6);
  assert.deepEqual(scriptIds(spell), [19003]);
  assert.equal(effect(spell, 1163, 2).triggers, 'D');
  assert.equal(spell.semanticStatus, 'source-unresolved');
  assert.equal(spell.runtimeRepresentation.sourceTruthConsumedByRuntime, false);
});
