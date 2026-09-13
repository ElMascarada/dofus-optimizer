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
  assert.match(html, /styles-optimizer-results\.css/);
  assert.match(html, /theme-color" content="#1c1a17"/);
  assert.doesNotMatch(html, /id=["']optimizer-class["']|id=["']optimizer-turn-mode["']/);
  assert.doesNotMatch(html, /js\/optimizer-v2-app\.js|js\/app-experimental\.js/);
  assert.doesNotMatch(html, /id=["']spell-list["']|FM Do Sorts|FM Do Crit/);
  assert.doesNotMatch(html, /SMALL|MEDIUM|LARGE|Top résultats|Exos structurels|Equipment-First|Set-Core-First/);
});

test('le contrôleur Equipment-Only reste mince et délègue au Worker et à la vue résultat', async () => {
  const source = await readFile(new URL('../js/optimizer-app.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /complete-equipment-build-evaluator|candidate-policy|set-core-catalog|architecture-search|searchEquipmentArchitecturesV2/);
  assert.match(source, /optimizer-worker\.js/);
  assert.match(source, /renderOptimizerResult/);
  assert.match(source, /optimizer-result-view\.js/);
  assert.match(source, /createWorkshopBuildFromOptimizerResult/);
  assert.match(source, /loadDofusData/);
  assert.match(source, /const advancedConstraints = new Map\(\[\['fm', 1\]\]\)/);
  assert.match(source, /topN: INTERNAL_RESULT_POOL/);
  assert.match(source, /DISPLAY_RESULT_LIMIT = 5/);
  assert.doesNotMatch(source, /loadSpellData|\bclassId\b|\bturnMode\b|\bcombatObjective\b/);
});

test('la vue résultat conserve le score théorique transparent et la nouvelle hiérarchie visuelle', async () => {
  const source = await readFile(new URL('../js/optimizer-result-view.js', import.meta.url), 'utf8');
  assert.match(source, /result\?\.syntheticOffense/);
  assert.match(source, /offense\?\.minimumScore/);
  assert.match(source, /offense\?\.meanScore/);
  assert.match(source, /offense\?\.multiElementScores/);
  assert.match(source, /probe\?\.totalApBudgetScore/);
  assert.match(source, /effectiveCritChancePct/);
  assert.match(source, /data-theoretical-damage/);
  assert.match(source, /optimizer-character-portrait/);
  assert.match(source, /item\?\.imageUrl/);
  assert.match(source, /optimizer-build-inspector/);
  assert.match(source, /Bonus de panoplies/);
  assert.match(source, /Modifications/);
  assert.match(source, /Attaques virtuelles standardisées utilisées par l’optimiseur/);
  assert.doesNotMatch(source, /minimumScore[\s\S]{0,120}result\?\.score/);
});
