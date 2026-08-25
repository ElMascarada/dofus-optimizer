import test from 'node:test';
import assert from 'node:assert/strict';

import { validateDofusSnapshot, validateSpellSnapshot } from '../js/data-loader.js';
import { statsForTurnDetailed } from '../js/spells.js';

test('Concentration ignores its summon-only second damage line on a normal target', () => {
  const snapshot = validateSpellSnapshot({
    schemaVersion: 1,
    breeds: [{ id: 'breed-8', name: 'Iop', spellIds: ['spell-13123'] }],
    spells: [{
      id: 'spell-13123',
      ankamaId: 13123,
      breedId: 'breed-8',
      name: 'Concentration',
      apCost: 2,
      certified: true,
      combatModifiers: [],
      hits: [
        { element: 'earth', normal: [20, 24], crit: [25, 30] },
        { element: 'earth', normal: [30, 34], crit: [37, 42] }
      ]
    }]
  });

  const concentration = snapshot.spells[0];
  assert.equal(concentration.hits.length, 1);
  assert.deepEqual(concentration.hits[0].normal, [20, 24]);
  assert.equal(concentration.curatedDamageRule, 'exclude-summon-only-secondary-hit');
});

test('Diadème de Ganymède applies its deterministic odd/even turn AP cycle', () => {
  const snapshot = validateDofusSnapshot({
    schemaVersion: 1,
    items: [{
      id: 'item-20360',
      ankamaId: 20360,
      name: 'Diadème de Ganymède',
      slot: 'hat',
      staticOnly: true,
      certified: false,
      stats: { ap: 1 },
      passives: []
    }],
    sets: []
  });
  const item = snapshot.items[0];
  const base = { ap: 12, mp: 6 };

  const t1 = statsForTurnDetailed(base, [item], 1).stats;
  const t2 = statsForTurnDetailed(base, [item], 2).stats;
  const t3 = statsForTurnDetailed(base, [item], 3).stats;

  assert.equal(t1.ap, 11);
  assert.equal(t2.ap, 14);
  assert.equal(t3.ap, 11);
  // The certified source description also states -1 PM on odd turns.
  assert.equal(t1.mp, 5);
  assert.equal(t2.mp, 6);
  assert.equal(t3.mp, 5);
});
