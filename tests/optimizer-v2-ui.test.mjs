import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const htmlUrl = new URL('../index.html', import.meta.url);

async function htmlSource() {
  return readFile(htmlUrl, 'utf8');
}

test('le parcours visible est un Optimiseur de stuff simple', async () => {
  const html = await htmlSource();
  for (const id of [
    'optimizer-min-ap', 'optimizer-min-mp', 'optimizer-constraint-key',
    'optimizer-constraint-value', 'optimizer-constraint-fm-value',
    'optimizer-constraint-add', 'optimizer-active-constraints',
    'optimizer-run', 'optimizer-results'
  ]) assert.match(html, new RegExp(`id=["']${id}["']`));
  assert.match(html, /data-optimizer-element/);
  assert.match(html, /data-optimizer-profile/);
  assert.match(html, /id="optimizer-element-multi"/);
  assert.match(html, /Petites lignes/);
  assert.match(html, /Mixte/);
  assert.match(html, /Grosses lignes/);
  assert.match(html, /<option value="fm">FM<\/option>/);
  assert.match(html, /js\/optimizer-app\.js/);
  assert.doesNotMatch(html, /id=["']optimizer-class["']|id=["']optimizer-turn-mode["']/);
  assert.doesNotMatch(html, /js\/optimizer-v2-app\.js|js\/app-experimental\.js/);
  assert.doesNotMatch(html, /id=["']spell-list["']|FM Do Sorts|FM Do Crit/);
  assert.doesNotMatch(html, /SMALL|MEDIUM|LARGE|Top résultats|Exos structurels|Equipment-First|Set-Core-First/);
});

test('le contrôleur Equipment-Only reste mince et délègue au Worker', async () => {
  const source = await readFile(new URL('../js/optimizer-app.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /complete-equipment-build-evaluator|candidate-policy|set-core-catalog|architecture-search|searchEquipmentArchitecturesV2/);
  assert.match(source, /optimizer-worker\.js/);
  assert.match(source, /createWorkshopBuildFromOptimizerResult/);
  assert.match(source, /Ouvrir dans l’Atelier/);
  assert.match(source, /loadDofusData/);
  assert.match(source, /const advancedConstraints = new Map\(\[\['fm', 1\]\]\)/);
  assert.match(source, /topN: INTERNAL_RESULT_POOL/);
  assert.match(source, /DISPLAY_RESULT_LIMIT = 5/);
  assert.doesNotMatch(source, /loadSpellData|\bclassId\b|\bturnMode\b|\bcombatObjective\b/);
});
