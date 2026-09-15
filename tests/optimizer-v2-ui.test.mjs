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
  assert.match(html, /id="optimizer-element-omni"/);
  assert.match(html, /Multi-lignes/);
  assert.match(html, /Tous éléments/);
  assert.match(html, /Petites lignes/);
  assert.match(html, /Mixte/);
  assert.match(html, /Grosses lignes/);
  assert.match(html, /<option value="fm">FM<\/option>/);
  assert.match(html, /js\/optimizer-app\.js/);
  assert.match(html, /styles-optimizer-results\.css/);
  assert.match(html, /styles-optimizer-professional\.css/);
  assert.match(html, /styles-product-professional\.css/);
  assert.match(html, /theme-color" content="#f5f0e8"/);
  assert.doesNotMatch(html, /id=["']optimizer-class["']|id=["']optimizer-turn-mode["']/);
  assert.doesNotMatch(html, /js\/optimizer-v2-app\.js|js\/app-experimental\.js/);
  assert.doesNotMatch(html, /id=["']spell-list["']|FM Do Sorts|FM Do Crit/);
  assert.doesNotMatch(html, /SMALL|MEDIUM|LARGE|Top résultats|Exos structurels|Equipment-First|Set-Core-First/);
});

test('Tous éléments est exclusif dans l UI et canonisé en quatre axes mono dans le Worker', async () => {
  const html = await htmlSource();
  const worker = await readFile(new URL('../js/optimizer-worker.js', import.meta.url), 'utf8');
  assert.match(html, /optimizer-element-omni/);
  assert.match(html, /omni\?\.addEventListener\('change'/);
  assert.match(html, /multi\?\.addEventListener\('change'/);
  assert.match(worker, /ALL_ELEMENTS = Object\.freeze\(\['earth', 'fire', 'water', 'air'\]\)/);
  assert.match(worker, /raw\.includes\('omni'\)/);
  assert.match(worker, /elements: \[\.\.\.ALL_ELEMENTS\]/);
  assert.match(worker, /Tous éléments est exclusif/);
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

test('la vue résultat conserve le score théorique transparent et la hiérarchie visuelle canonique', async () => {
  const source = await readFile(new URL('../js/optimizer-result-view.js', import.meta.url), 'utf8');
  assert.match(source, /result\?\.syntheticOffense\?\.minimumScore/);
  assert.match(source, /data-theoretical-damage/);
  assert.match(source, /Dégâts théoriques/);
  assert.match(source, /optimizer-character-portrait/);
  assert.match(source, /item\?\.imageUrl/);
  assert.match(source, /optimizer-build-summary/);
  assert.match(source, /optimizer-build-inspector/);
  assert.match(source, /Stats & dégâts/);
  assert.match(source, /Secondaires & défenses/);
  assert.match(source, /Forgemagie/);
  assert.match(source, /data-build-modifications/);
  assert.match(source, /Bonus de panoplies/);
  assert.match(source, /data-combined-with="\$\{escapeHtml\(options\.combinedWith\)\}"/);
  assert.doesNotMatch(source, /result\?\.score/);
  assert.doesNotMatch(source, /Crit effectif|Budget test|Moyenne des axes|Profil test/);
});
