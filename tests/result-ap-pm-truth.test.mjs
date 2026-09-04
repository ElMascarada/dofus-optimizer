import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { optimizerApMpTruth } from '../js/optimizer-v2-result-truth.js';

test('le rendu calcule le T1 depuis les bonus de ressources avant toute dépense de rotation', () => {
  const truth = optimizerApMpTruth({
    stats: { ap: 12, mp: 6 },
    // Cette valeur représente volontairement un ancien état ambigu après une
    // préparation à 1 PA. Elle ne doit plus piloter la vérité d'affichage.
    effectiveStatsByTurn: { 1: { ap: 13, mp: 6 } },
    resourceBonusesByTurn: { 1: { ap: 2, mp: 0 } }
  });

  assert.deepEqual(truth, {
    permanentAp: 12,
    permanentMp: 6,
    t1: { ap: 14, mp: 6, bonusAp: 2, bonusMp: 0 }
  });
});

test('le rendu ne crée pas de ligne T1 quand les bonus PA et PM sont nuls', () => {
  const truth = optimizerApMpTruth({
    stats: { ap: 12, mp: 6 },
    effectiveStatsByTurn: { 1: { ap: 12, mp: 6 } },
    resourceBonusesByTurn: { 1: { ap: 0, mp: 0 } }
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
      effectiveStatsByTurn: { 1: { ap: 13, mp: 6 } },
      resourceBonusesByTurn: { 1: { ap: 2, mp: 0 } }
    },
    {
      id: 'second',
      score: 200,
      stats: { ap: 11, mp: 6 },
      effectiveStatsByTurn: { 1: { ap: 11, mp: 6 } },
      resourceBonusesByTurn: { 1: { ap: 0, mp: 0 } }
    }
  ];
  const before = structuredClone(builds);
  const rankingBefore = builds.map(({ id, score }) => ({ id, score }));

  builds.map(optimizerApMpTruth);

  assert.deepEqual(builds, before);
  assert.deepEqual(builds.map(({ id, score }) => ({ id, score })), rankingBefore);
});

test('le renderer V2 explicite permanent, bonus T1 et ressources disponibles avant actions', async () => {
  const source = await readFile(new URL('../js/optimizer-v2-app.js', import.meta.url), 'utf8');
  assert.match(source, /optimizerApMpTruth\(build\)/);
  assert.match(source, /PA permanents/);
  assert.match(source, /PM permanents/);
  assert.match(source, /Bonus T1/);
  assert.match(source, /PA\/PM au T1/);
  assert.match(source, /disponibles avant actions/);
});
