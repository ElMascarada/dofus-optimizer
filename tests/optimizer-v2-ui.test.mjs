import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const htmlUrl = new URL('../index.html', import.meta.url);
const appUrl = new URL('../js/optimizer-v2-app.js', import.meta.url);

async function htmlSource() {
  return readFile(htmlUrl, 'utf8');
}

async function combatPreviewRenderer() {
  const source = await readFile(appUrl, 'utf8');
  const start = source.indexOf('function escapeHtml');
  const end = source.indexOf('function stateMarkup');
  assert.ok(start >= 0 && end > start, 'combat preview helper block should remain directly testable');
  const context = {};
  runInNewContext(`${source.slice(start, end)}\nthis.renderCombatPreview = combatPreviewMarkup;`, context);
  return { source, renderCombatPreview: context.renderCombatPreview };
}

function textFromMarkup(markup) {
  return String(markup).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
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
  const source = await readFile(appUrl, 'utf8');
  assert.doesNotMatch(source, /complete-build-evaluator|candidate-policy|set-core-catalog|architecture-search|solver\.js/);
  assert.match(source, /createOptimizerV2Request/);
  assert.match(source, /optimizer-worker\.js/);
  assert.match(source, /createWorkshopBuildFromOptimizerResult/);
  assert.match(source, /Ouvrir et ajuster dans l’Atelier/);
});

test('une carte avec plan de combat affiche dégâts du tour, rotation et dégâts par sort', async () => {
  const { renderCombatPreview } = await combatPreviewRenderer();
  const markup = renderCombatPreview({
    score: 4662.55,
    perTurn: { 1: 4662.55 },
    combatPlan: {
      sequence: [
        { turn: 1, spellId: 'epee-de-iop', name: 'Épée de Iop', expectedDamage: 1741.505 },
        { turn: 1, spellId: 'epee-de-iop', name: 'Épée de Iop', expectedDamage: 1741.505 },
        { turn: 1, spellId: 'fureur', name: 'Fureur', expectedDamage: 1179.54 }
      ]
    }
  }, 't1');
  const text = textFromMarkup(markup);

  assert.match(text, /T1 — 4 663 dégâts/);
  assert.match(text, /Épée de Iop ×2 → Fureur ×1/);
  assert.match(text, /Dégâts par sort/);
  assert.match(text, /Épée de Iop 3 483/);
  assert.match(text, /Fureur 1 180/);
});

test('le score reste explicitement distingué des dégâts réels', async () => {
  const { source } = await combatPreviewRenderer();
  assert.match(source, /<small>score de l’objectif<\/small>/);
  assert.match(source, /<strong>T\$\{turn\} — \$\{fmtDamage\(turnDamage\)\} dégâts<\/strong>/);
});

test('un résultat sans plan détaillé reste rendu sans erreur', async () => {
  const { renderCombatPreview } = await combatPreviewRenderer();
  assert.doesNotThrow(() => renderCombatPreview({ score: 1200, perTurn: { 1: 1200 } }, 't1'));
  assert.match(renderCombatPreview({ score: 1200, perTurn: { 1: 1200 } }, 't1'), /Rotation détaillée indisponible/);
});

test('le mode multi-tour affiche chaque tour de combat disponible', async () => {
  const { renderCombatPreview } = await combatPreviewRenderer();
  const markup = renderCombatPreview({
    perTurn: { 1: 1000, 2: 1200, 3: 1400 },
    combatPlan: {
      sequence: [
        { turn: 1, spellId: 'a', name: 'Sort A', expectedDamage: 1000 },
        { turn: 2, spellId: 'b', name: 'Sort B', expectedDamage: 1200 },
        { turn: 3, spellId: 'c', name: 'Sort C', expectedDamage: 1400 }
      ]
    }
  }, 'sum');
  const text = textFromMarkup(markup);
  assert.match(text, /T1 — 1 000 dégâts/);
  assert.match(text, /T2 — 1 200 dégâts/);
  assert.match(text, /T3 — 1 400 dégâts/);
});
