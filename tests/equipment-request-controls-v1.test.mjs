import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { evaluateSyntheticOffense } from '../js/synthetic-offense.js';

test('Sans crit ignores Crit and Do Crit in the synthetic objective', () => {
  const base = evaluateSyntheticOffense({
    stats: { earth: 500, damage: 80, crit: 0, critDamage: 0 },
    availableAp: 12,
    elements: ['earth'],
    profiles: ['large'],
    critMode: 'no_crit'
  });
  const critHeavy = evaluateSyntheticOffense({
    stats: { earth: 500, damage: 80, crit: 70, critDamage: 180 },
    availableAp: 12,
    elements: ['earth'],
    profiles: ['large'],
    critMode: 'no_crit'
  });
  assert.equal(critHeavy.minimumScore, base.minimumScore);
  assert.equal(critHeavy.meanScore, base.meanScore);
  assert.equal(critHeavy.requestedProbes[0].effectiveCritChancePct, 0);
});

test('Crit mode keeps the normal crit-aware objective', () => {
  const auto = evaluateSyntheticOffense({
    stats: { earth: 500, damage: 80, crit: 35, critDamage: 90 },
    availableAp: 12,
    elements: ['earth'],
    profiles: ['large'],
    critMode: 'auto'
  });
  const crit = evaluateSyntheticOffense({
    stats: { earth: 500, damage: 80, crit: 35, critDamage: 90 },
    availableAp: 12,
    elements: ['earth'],
    profiles: ['large'],
    critMode: 'crit'
  });
  assert.equal(crit.minimumScore, auto.minimumScore);
  assert.equal(crit.meanScore, auto.meanScore);
});

test('Equipment-Only UI exposes crit modes and richer constraints', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  for (const mode of ['auto', 'crit', 'no_crit']) {
    assert.match(html, new RegExp(`data-optimizer-crit-mode[^>]+value=["']${mode}["']`));
  }
  for (const key of [
    'crit', 'critDamage', 'damage', 'spellDamagePct', 'power',
    'earth', 'fire', 'water', 'air',
    'damageEarth', 'damageFire', 'damageWater', 'damageAir'
  ]) {
    assert.match(html, new RegExp(`<option value=["']${key}["']>`));
  }
  assert.match(html, /01 · Offense/);
  assert.match(html, /02 · Contraintes/);
});

test('Optimizer controller transports the selected crit mode', async () => {
  const source = await readFile(new URL('../js/optimizer-app.js', import.meta.url), 'utf8');
  assert.match(source, /data-optimizer-crit-mode/);
  assert.match(source, /critMode/);
});

test('Workshop exposes distinct Remplacer and Retirer actions', async () => {
  const source = await readFile(new URL('../js/workshop/equipment-grid.js', import.meta.url), 'utf8');
  assert.match(source, />Remplacer<\/button>/);
  assert.match(source, /Retirer sans exclure cet item/);
  assert.match(source, /Retirer et exclure cet item des prochaines recherches/);
});
