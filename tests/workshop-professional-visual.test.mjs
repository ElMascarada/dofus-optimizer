import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('les sélections Optimiseur utilisent une seule convention visuelle', async () => {
  const css = await readFile(new URL('../styles-product-professional.css', import.meta.url), 'utf8');

  assert.match(css, /#optimizer-view \.optimizer-segmented input:checked \+ span \{[\s\S]*margin:\s*2px;/);
  assert.match(css, /#optimizer-view \.optimizer-segmented input:checked \+ span \{[\s\S]*border:\s*1px solid rgba\(196, 122, 42, \.44\)/);
  assert.match(css, /#optimizer-view \.optimizer-segmented input:checked \+ span \{[\s\S]*border-radius:\s*10px;/);
  assert.match(css, /#optimizer-view \.optimizer-segmented input:checked \+ span \{[\s\S]*background:\s*linear-gradient/);
  assert.doesNotMatch(css, /inset 0 -2px 0/);
});

test('l Atelier partage le système visuel professionnel clair', async () => {
  const css = await readFile(new URL('../styles-product-professional.css', import.meta.url), 'utf8');

  assert.match(css, /#workshop-view \{[\s\S]*--workshop-black:\s*#fffdf8;/i);
  assert.match(css, /#workshop-view \.workshop-hero \{[\s\S]*linear-gradient/i);
  assert.match(css, /#workshop-view \.workshop-hero::before \{[\s\S]*url\('\.\/assets\/app\/icon-180\.png'\)/i);
  assert.match(css, /#workshop-view \.workshop-build-library \{[\s\S]*rgba\(226, 162, 58, \.065\)/i);
  assert.match(css, /#workshop-view \.workshop-equipment-panel \{[\s\S]*radial-gradient/i);
  assert.match(css, /#workshop-view \.workshop-stats-panel \{[\s\S]*rgba\(169, 180, 140, \.10\)/i);
  assert.match(css, /#workshop-view \.workshop-slot\.is-locked \{[\s\S]*rgba\(118, 130, 88, \.46\)/i);
  assert.doesNotMatch(css, /background:\s*#000\b|#090a0a|#030303/i);
});

test('le calque produit est chargé en dernier et précaché', async () => {
  const [index, serviceWorker] = await Promise.all([
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../service-worker.js', import.meta.url), 'utf8')
  ]);

  const optimizerProfessional = index.indexOf('styles-optimizer-professional.css');
  const productProfessional = index.indexOf('styles-product-professional.css');
  assert.ok(optimizerProfessional >= 0 && productProfessional > optimizerProfessional);
  assert.match(serviceWorker, /\.\/styles-product-professional\.css/);
});

test('le browser smoke suit la copie FM canonique actuelle', async () => {
  const browserSmoke = await readFile(new URL('../scripts/recipe-v2-browser-smoke.mjs', import.meta.url), 'utf8');

  assert.match(browserSmoke, /FM Oui · Exo PA \+ PM inclus/);
  assert.doesNotMatch(browserSmoke, /FM : Oui · Exo PA \+ PM/);
});
