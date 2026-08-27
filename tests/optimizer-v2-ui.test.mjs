import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const htmlUrl = new URL('../index.html', import.meta.url);

async function htmlSource() {
  return readFile(htmlUrl, 'utf8');
}

test('le parcours visible est bien le V2 simplifié et ne charge plus l’ancien contrôleur UI', async () => {
  const html = await htmlSource();
  for (const id of [
    'optimizer-class', 'optimizer-element', 'optimizer-min-ap', 'optimizer-min-mp',
    'optimizer-min-range', 'optimizer-min-vit', 'optimizer-min-initiative',
    'optimizer-res-earth', 'optimizer-res-fire', 'optimizer-res-water', 'optimizer-res-air',
    'optimizer-turn-mode', 'optimizer-run', 'optimizer-results'
  ]) assert.match(html, new RegExp(`id=["']${id}["']`));
  assert.match(html, /js\/optimizer-v2-app\.js/);
  assert.doesNotMatch(html, /js\/app-experimental\.js/);
  assert.doesNotMatch(html, /id=["']spell-list["']/);
  assert.doesNotMatch(html, /id=["']fm-spell["']/);
});

test('le contrôleur UI V2 ne réimplémente ni solveur ni évaluation métier', async () => {
  const source = await readFile(new URL('../js/optimizer-v2-app.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /complete-build-evaluator|candidate-policy|set-core-catalog|architecture-search|solver\.js/);
  assert.match(source, /createOptimizerV2Request/);
  assert.match(source, /optimizer-worker\.js/);
  assert.match(source, /createWorkshopBuildFromOptimizerResult/);
  assert.match(source, /Ouvrir et ajuster dans l’Atelier/);
});