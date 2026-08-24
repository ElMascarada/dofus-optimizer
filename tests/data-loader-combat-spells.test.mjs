import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSpellSnapshot } from '../js/data-loader.js';

test('browser spell loader keeps support-only combat spells and variants', () => {
  const data = validateSpellSnapshot({
    schemaVersion: 1,
    source: 'test',
    game: 'dofus3',
    language: 'fr',
    breeds: [{ id: 'breed-8', name: 'Iop', spellIds: ['spell-hit', 'spell-power'] }],
    spells: [
      {
        id: 'spell-hit',
        breedId: 'breed-8',
        name: 'Attaque',
        apCost: 4,
        certified: true,
        hits: [{ element: 'air', normal: [30, 30], crit: [35, 35] }],
        combatModifiers: []
      },
      {
        id: 'spell-power',
        breedId: 'breed-8',
        name: 'Puissance',
        apCost: 2,
        certified: true,
        isVariant: true,
        hits: [],
        combatModifiers: [{ scope: 'self', stats: { power: 200 }, durationTurns: 2 }],
        supportOnly: true
      }
    ]
  });

  assert.equal(data.spells.length, 2);
  assert.equal(data.spells[1].isVariant, true);
  assert.equal(data.spells[1].supportOnly, true);
  assert.deepEqual(data.breeds[0].spellIds, ['spell-hit', 'spell-power']);
});
