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

function fixtureResult() {
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

  return {
    items,
    stats: {
      ap: 12,
      mp: 6,
      range: 2,
      vit: 4696,
      wisdom: 480,
      initiative: 3297,
      earth: 274,
      fire: 274,
      water: 274,
      air: 275,
      power: 360,
      crit: 82,
      critDamage: 291,
      damage: 52,
      damageNeutral: 10,
      damageEarth: 35,
      damageFire: 30,
      damageWater: 50,
      damageAir: 30,
      spellDamagePct: 11,
      meleeDamagePct: 5,
      rangedDamagePct: 14,
      dodge: 85,
      lock: 45,
      apParry: 48,
      mpParry: 63,
      apReduction: 68,
      mpReduction: 48,
      resNeutral: 5,
      resEarth: 17,
      resFire: 9,
      resWater: 26,
      resAir: 19,
      critResistance: -30,
      meleeResistance: -6,
      rangedResistance: -12
    },
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
    syntheticOffense: {
      minimumScore: 1391.1075
    }
  };
}

test('le résultat visuel place les équipements autour du portrait et garde les données métier', () => {
  const html = renderOptimizerResult(fixtureResult(), 0);

  assert.match(html, /data-character-portrait="neutral"/);
  assert.match(html, /Coiffe Test/);
  assert.match(html, /https:\/\/api\.example\.test\/hat-1\.png/);
  assert.match(html, /Kokulte/);
  assert.match(html, /Dofus 6/);
  assert.match(html, /Dégâts théoriques/);
  assert.match(html, /1.?391/);
  assert.match(html, /Exo PA/);
  assert.match(html, /\+8 Do Crit/);
  assert.match(html, /Bonus de panoplies/);
  assert.match(html, /Panoplie Test/);
  assert.match(html, /Ouvrir dans l’Atelier/);
});

test('la hiérarchie de stats combine puissance et dommages fixes sans doublons', () => {
  const html = renderOptimizerResult(fixtureResult(), 0);

  assert.match(html, /Stats & dégâts/);
  assert.match(html, /data-stat-key="vit"/);
  assert.match(html, /data-stat-key="initiative"/);
  assert.match(html, /data-stat-key="earth" data-combined-with="power"[\s\S]*?274[\s\S]*?\(634\)/);
  assert.match(html, /data-stat-key="air" data-combined-with="power"[\s\S]*?275[\s\S]*?\(635\)/);
  assert.match(html, />Do fixe<\/span>[\s\S]*?>52</);
  assert.match(html, /data-stat-key="damageEarth" data-combined-with="damage"[\s\S]*?35[\s\S]*?\(87\)/);
  assert.match(html, /data-stat-key="damageWater" data-combined-with="damage"[\s\S]*?50[\s\S]*?\(102\)/);
  assert.match(html, /% Do Mêlée/);
  assert.match(html, /% Do Distance/);

  assert.equal((html.match(/data-stat-key="vit"/g) || []).length, 1);
  assert.equal((html.match(/data-stat-key="initiative"/g) || []).length, 1);
  assert.equal((html.match(/data-stat-key="earth"/g) || []).length, 1);
  assert.equal((html.match(/data-stat-key="damageEarth"/g) || []).length, 1);

  assert.doesNotMatch(html, /Crit effectif|Budget test|Moyenne des axes|Profil test/);
  assert.doesNotMatch(html, /optimizer-build-extras/);
});

test('FM reste dans la colonne gauche et les bonus pano dans la colonne droite', () => {
  const html = renderOptimizerResult(fixtureResult(), 0);
  const leftStart = html.indexOf('<aside class="optimizer-build-summary">');
  const equipmentStart = html.indexOf('<div class="optimizer-build-equipment">');
  const fm = html.indexOf('optimizer-build-fm');
  const rightStart = html.indexOf('<aside class="optimizer-build-inspector">');
  const sets = html.indexOf('optimizer-build-sets');
  const footer = html.indexOf('<footer class="optimizer-build-footer">');

  assert.ok(leftStart >= 0 && fm > leftStart && fm < equipmentStart);
  assert.ok(rightStart >= 0 && sets > rightStart && sets < footer);
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

  assert.match(css, /\.optimizer-character-portrait \{ grid-column:2; grid-row:1\/6;/);
  assert.match(css, /\.optimizer-dofus-row \{ grid-column:1\/-1; grid-row:6;/);
});
