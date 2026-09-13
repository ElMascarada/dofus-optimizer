import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { renderOptimizerResult } from '../js/optimizer-result-view.js';

function item(id, name, slot) {
  return {
    id,
    name,
    slot,
    imageUrl: `https://api.example.test/${id}.png`
  };
}

test('le résultat visuel place les équipements autour du portrait et garde les données métier', () => {
  const items = [
    item('hat-1', 'Coiffe Test', 'hat'),
    item('cape-1', 'Cape Test', 'cape'),
    item('amulet-1', 'Amulette Test', 'amulet'),
    item('ring-1', 'Anneau Test A', 'ring'),
    item('ring-2', 'Anneau Test B', 'ring'),
    item('belt-1', 'Ceinture Test', 'belt'),
    item('boots-1', 'Bottes Test', 'boots'),
    item('weapon-1', 'Arme Test', 'weapon'),
    item('shield-1', 'Bouclier Test', 'shield'),
    item('pet-1', 'Kokulte', 'companion'),
    ...Array.from({ length: 6 }, (_, index) => item(`dofus-${index + 1}`, `Dofus ${index + 1}`, 'dofus'))
  ];

  const result = {
    items,
    stats: {
      ap: 12,
      mp: 6,
      range: 2,
      vit: 4696,
      initiative: 3297,
      earth: 274,
      fire: 274,
      water: 274,
      air: 275,
      power: 360,
      crit: 82,
      critDamage: 291,
      spellDamagePct: 11,
      damageEarth: 35,
      damageFire: 35,
      damageWater: 35,
      damageAir: 35,
      resEarth: 17
    },
    characteristics: { earth: 174, fire: 174, water: 174, air: 175 },
    fm: {
      enabled: true,
      assignments: [
        { itemId: 'hat-1', type: 'exoAp', value: 1 },
        { itemId: 'cape-1', type: 'exoMp', value: 1 },
        { itemId: 'belt-1', type: 'spellDamagePct', value: 1 },
        { itemId: 'boots-1', type: 'critDamage', value: 8 }
      ]
    },
    activeSets: [
      { name: 'Panoplie Test', count: 3, bonus: { power: 50, crit: 5 } }
    ],
    syntheticApBudget: 12,
    syntheticOffense: {
      availableAp: 12,
      elements: ['multi'],
      profiles: ['large'],
      minimumScore: 1391.1075,
      meanScore: 1410.5,
      multiElementScores: { earth: 1391.1, fire: 1402.2, water: 1414.3, air: 1434.4 },
      requestedProbes: [{ profile: 'large', effectiveCritChancePct: 100 }]
    }
  };

  const html = renderOptimizerResult(result, 0);

  assert.match(html, /data-character-portrait="neutral"/);
  assert.match(html, /Coiffe Test/);
  assert.match(html, /https:\/\/api\.example\.test\/hat-1\.png/);
  assert.match(html, /Kokulte/);
  assert.match(html, /Dofus 6/);
  assert.match(html, /Dégâts théoriques/);
  assert.match(html, /1.?391/);
  assert.match(html, /Crit effectif/);
  assert.match(html, /100 %/);
  assert.match(html, /Exo PA/);
  assert.match(html, /\+8 Do Crit/);
  assert.match(html, /Bonus de panoplies/);
  assert.match(html, /Panoplie Test/);
  assert.match(html, /data-stat-key="crit"/);
  assert.match(html, /Ouvrir dans l’Atelier/);
});

test('le placement visuel des dix équipements suit le layout produit canonique', async () => {
  const css = await readFile(new URL('../styles-optimizer-results.css', import.meta.url), 'utf8');

  const expected = [
    ['amulet', 1, 1],
    ['shield', 1, 2],
    ['ring-1', 1, 3],
    ['belt', 1, 4],
    ['boots', 1, 5],
    ['hat', 3, 1],
    ['weapon', 3, 2],
    ['ring-2', 3, 3],
    ['cape', 3, 4],
    ['companion', 3, 5]
  ];

  for (const [slot, column, row] of expected) {
    const pattern = new RegExp(`\\.optimizer-loadout \\.${slot.replace('-', '\\-')} \\{ grid-column:${column}; grid-row:${row}; \\}`);
    assert.match(css, pattern, `${slot} doit être en colonne ${column}, ligne ${row}`);
  }

  assert.match(css, /\.optimizer-character-portrait \{ grid-column:2; grid-row:1 \/ 6;/);
  assert.match(css, /\.optimizer-dofus-row \{ grid-column:1\/-1; grid-row:6;/);
});
