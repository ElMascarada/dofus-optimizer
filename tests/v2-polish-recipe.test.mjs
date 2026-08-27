import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('final V2 shell uses only the current product entrypoints and neo-retro polish layer', () => {
  const html = source('index.html');
  assert.match(html, /styles-v2-polish\.css/);
  assert.match(html, /js\/workshop\/workshop-app\.js/);
  assert.match(html, /js\/optimizer-v2-app\.js/);
  assert.doesNotMatch(html, /styles-experimental\.css/);
  assert.doesNotMatch(html, /styles-session\.css/);
  assert.doesNotMatch(html, /app-experimental\.js/);
  assert.match(html, /aria-controls="workshop-view"/);
  assert.match(html, /aria-controls="optimizer-view"/);
});

test('final palette, semantic states, focus and responsive rules are explicit', () => {
  const css = source('styles-v2-polish.css').toLowerCase();
  assert.match(css, /--bg:\s*#000000/);
  assert.match(css, /--text:\s*#cccfca/);
  assert.match(css, /--accent:\s*#dc2636/);
  assert.match(css, /\.ui-state/);
  assert.match(css, /data-state="error"/);
  assert.match(css, /focus-visible/);
  assert.match(css, /@media \(max-width: 680px\)/);
  assert.match(css, /prefers-reduced-motion/);
});

test('Atelier and Optimizer expose the complete round-trip and accessible interaction states', () => {
  const workshop = source('js/workshop/workshop-app.js');
  const equipment = source('js/workshop/equipment-grid.js');
  const optimizer = source('js/optimizer-v2-app.js');

  for (const token of ['ArrowLeft', 'ArrowRight', 'Home', 'End', 'FIND_BETTER_BUILD_EVENT', 'OPEN_WORKSHOP_BUILD_EVENT']) {
    assert.match(workshop, new RegExp(token));
  }
  assert.match(workshop, /workshop-slot-progress/);
  assert.match(workshop, /workshop-find-better-hint/);
  assert.match(equipment, /keydown/);
  assert.match(equipment, /Enter/);
  assert.match(equipment, /Verrouiller/);
  assert.match(equipment, /Rejeter/);
  assert.match(equipment, /Retirer/);

  assert.match(optimizer, /FIND_BETTER_BUILD_EVENT/);
  assert.match(optimizer, /OPEN_WORKSHOP_BUILD_EVENT/);
  assert.match(optimizer, /setRefinementContext/);
  assert.match(optimizer, /setSearchControlsDisabled/);
  assert.match(optimizer, /renderState\('loading'/);
  assert.match(optimizer, /renderState\('error'/);
  assert.match(optimizer, /renderState\('empty'/);
  assert.match(optimizer, /Ouvrir et ajuster dans l’Atelier/);
});

test('service-worker cache is V2-only while search/rules version stays stable', () => {
  const worker = source('service-worker.js');
  const runtime = source('js/runtime-meta.js');

  assert.match(worker, /styles-v2-polish\.css/);
  for (const legacy of [
    'styles-experimental.css',
    'styles-session.css',
    'app-experimental.js',
    'spell-ui-enhancements.js',
    'optimizer-session-bridge.js',
    'optimizer-stop-bridge.js'
  ]) {
    assert.doesNotMatch(worker, new RegExp(legacy.replaceAll('.', '\\.')));
  }
  assert.match(runtime, /appVersion:\s*'0\.14\.2'/);
  assert.match(runtime, /v2-final-ui-1/);
});
