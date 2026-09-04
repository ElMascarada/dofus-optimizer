import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { optimizerApMpTruth } from '../js/optimizer-v2-result-truth.js';

test('le rendu distingue les PA permanents du PA dynamique T1', () => {
  const truth = optimizerApMpTruth({
    stats: { ap: 12, mp: 6 },
    effectiveStatsByTurn: { 1: { ap: 13, mp: 6 } }
  });

  assert.deepEqual(truth, {
    permanentAp: 12,
    permanentMp: 6,
    t1: { ap: 13, mp: 6 }
  });
});

test('le rendu ne crée pas de ligne T1 quand PA et PM sont identiques aux permanents', () => {
  const truth = optimizerApMpTruth({
    stats: { ap: 12, mp: 6 },
    effectiveStatsByTurn: { 1: { ap: 12, mp: 6 } }
  });

  assert.deepEqual(truth, {
    permanentAp: 12,
    permanentMp: 6,
    t1: null
  });
});

test('la lecture de vérité PA/PM ne modifie ni résultats, ni ordre, ni scores', () => {
  const builds = [
    {
      id: 'first',
      score: 250,
      stats: { ap: 12, mp: 6 },
      effectiveStatsByTurn: { 1: { ap: 13, mp: 6 } }
    },
    {
      id: 'second',
      score: 200,
      stats: { ap: 11, mp: 6 },
      effectiveStatsByTurn: { 1: { ap: 11, mp: 6 } }
    }
  ];
  const before = structuredClone(builds);
  const rankingBefore = builds.map(({ id, score }) => ({ id, score }));

  builds.map(optimizerApMpTruth);

  assert.deepEqual(builds, before);
  assert.deepEqual(builds.map(({ id, score }) => ({ id, score })), rankingBefore);
});

test('le renderer V2 explicite permanent et T1 dynamique', async () => {
  const source = await readFile(new URL('../js/optimizer-v2-app.js', import.meta.url), 'utf8');
  assert.match(source, /optimizerApMpTruth\(build\)/);
  assert.match(source, /PA permanents/);
  assert.match(source, /PM permanents/);
  assert.match(source, /optimizer-v2-t1-effective/);
  assert.match(source, /après bonus dynamiques/);
});
