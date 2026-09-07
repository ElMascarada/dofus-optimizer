import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const htmlUrl = new URL('../index.html', import.meta.url);
const cssUrl = new URL('../styles-optimizer-v2.css', import.meta.url);

test('search timing markup exposes spinner, live elapsed time and final duration near Optimiser', async () => {
  const html = await readFile(htmlUrl, 'utf8');
  const runIndex = html.indexOf('id="optimizer-run"');
  const timingIndex = html.indexOf('id="optimizer-search-timing"');
  const diagnosticsIndex = html.indexOf('id="optimizer-diagnostics"');

  assert.ok(runIndex >= 0);
  assert.ok(timingIndex > runIndex);
  assert.ok(diagnosticsIndex > timingIndex);
  assert.match(html, /id="optimizer-search-spinner"/);
  assert.match(html, /id="optimizer-search-elapsed">0\.0 s/);
  assert.match(html, /id="optimizer-search-final"/);
  assert.match(html, /search-loading-elapsed-time\.js/);
});

test('search spinner is a real visual loading indicator without fake progress UI', async () => {
  const css = await readFile(cssUrl, 'utf8');
  const html = await readFile(htmlUrl, 'utf8');

  assert.match(css, /\.optimizer-search-spinner/);
  assert.match(css, /@keyframes optimizer-search-spin/);
  assert.doesNotMatch(html, /progressbar|aria-valuenow|% restant|temps restant/i);
});
