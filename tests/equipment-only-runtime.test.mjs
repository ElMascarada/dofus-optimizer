import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('active Optimizer shell is Equipment-Only', async () => {
  const html = await read('index.html');
  assert.doesNotMatch(html, /id="optimizer-class"/);
  assert.doesNotMatch(html, /id="optimizer-turn-mode"/);
  assert.doesNotMatch(html, /optimizer-v2-app\.js/);
  assert.match(html, /js\/optimizer-app\.js/);
  assert.match(html, /data-optimizer-profile/);
  assert.match(html, /id="optimizer-element-multi"/);
});

test('optimizer app loads equipment data only', async () => {
  const source = await read('js/optimizer-app.js');
  assert.match(source, /loadDofusData/);
  assert.doesNotMatch(source, /loadSpellData/);
  assert.doesNotMatch(source, /\bclassId\b/);
  assert.doesNotMatch(source, /\bturnMode\b/);
  assert.doesNotMatch(source, /\bcombatObjective\b/);
  assert.doesNotMatch(source, /search-memory/);
});

test('optimizer worker is a thin Equipment-First entrypoint', async () => {
  const source = await read('js/optimizer-worker.js');
  assert.match(source, /searchEquipmentArchitecturesV2/);
  for (const forbidden of [
    'architecture-search-v2',
    'combat-turn-refiner',
    'offensive-slot-refiner',
    'combat-feedback',
    'final-dofus-local-repair'
  ]) {
    assert.doesNotMatch(source, new RegExp(forbidden));
  }
});

test('active shell has no spell-driven optimizer copy', async () => {
  const html = await read('index.html');
  assert.doesNotMatch(html, /FM Do Sorts|FM Do Crit|T1\/T2\/T3|Résultats combat|Classe →/);
});
