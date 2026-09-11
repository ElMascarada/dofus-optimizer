import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const htmlUrl = new URL('../index.html', import.meta.url);

async function htmlSource() {
  return readFile(htmlUrl, 'utf8');
}

test('le parcours visible est Equipment-Only', async () => {
  const html = await htmlSource();
  for (const id of [
    'optimizer-min-ap', 'optimizer-min-mp', 'optimizer-min-range', 'optimizer-min-vit',
    'optimizer-min-initiative', 'optimizer-res-earth', 'optimizer-res-fire',
    'optimizer-res-water', 'optimizer-res-air', 'optimizer-fm-exo-ap',
    'optimizer-fm-exo-mp', 'optimizer-top-n', 'optimizer-run', 'optimizer-results'
  ]) assert.match(html, new RegExp(`id=["']${id}["']`));
  assert.match(html, /data-optimizer-element/);
  assert.match(html, /data-optimizer-profile/);
  assert.match(html, /id="optimizer-element-multi"/);
  assert.match(html, /js\/optimizer-app\.js/);
  assert.doesNotMatch(html, /id=["']optimizer-class["']|id=["']optimizer-turn-mode["']/);
  assert.doesNotMatch(html, /js\/optimizer-v2-app\.js|js\/app-experimental\.js/);
  assert.doesNotMatch(html, /id=["']spell-list["']|FM Do Sorts|FM Do Crit/);
});

test('le contrôleur Equipment-Only reste mince et délègue au Worker', async () => {
  const source = await readFile(new URL('../js/optimizer-app.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /complete-equipment-build-evaluator|candidate-policy|set-core-catalog|architecture-search|searchEquipmentArchitecturesV2/);
  assert.match(source, /optimizer-worker\.js/);
  assert.match(source, /createWorkshopBuildFromOptimizerResult/);
  assert.match(source, /Ouvrir dans l’Atelier/);
  assert.match(source, /loadDofusData/);
  assert.doesNotMatch(source, /loadSpellData|\bclassId\b|\bturnMode\b|\bcombatObjective\b/);
});
