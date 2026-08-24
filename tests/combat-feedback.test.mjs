import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCombatFeedbackSelections,
  preferCompanionVitalityOnTies
} from '../js/combat-feedback.js';

const spells = [
  { id: 'used', name: 'Used', hits: [{ element: 'earth', normal: [20, 20], crit: [20, 20] }] },
  { id: 'unused', name: 'Unused', hits: [{ element: 'earth', normal: [100, 100], crit: [100, 100] }] },
  { id: 'support', name: 'Support', hits: [], combatModifiers: [{ stats: { power: 200 } }] }
];

test('combat feedback weights only damaging spells actually cast by the chosen rotations', () => {
  const results = [{
    combatPlan: {
      sequence: [
        { turn: 1, spellId: 'support', expectedDamage: 0 },
        { turn: 1, spellId: 'used', expectedDamage: 500 },
        { turn: 1, spellId: 'used', expectedDamage: 500 }
      ]
    }
  }];

  const selections = buildCombatFeedbackSelections({ results, spells, turnMode: 't1' });
  assert.equal(selections.length, 1);
  assert.equal(selections[0].spell.id, 'used');
  assert.equal(selections[0].casts[1], 2);
  assert.equal(selections[0].casts[2], 0);
  assert.equal(selections[0].casts[3], 0);
});

test('alternate top rotations stay represented but the best rotation has the strongest weight', () => {
  const results = [
    { combatPlan: { sequence: [{ turn: 1, spellId: 'used', expectedDamage: 500 }] } },
    { combatPlan: { sequence: [{ turn: 1, spellId: 'unused', expectedDamage: 400 }] } }
  ];

  const selections = buildCombatFeedbackSelections({ results, spells, turnMode: 't1' });
  const byId = Object.fromEntries(selections.map((selection) => [selection.spell.id, selection]));
  assert.ok(byId.used.casts[1] > byId.unused.casts[1]);
});

test('equal-damage companion source ties prefer the candidate with more Vitality', () => {
  const kompost = { id: 'kompost', slot: 'companion', stats: { earth: 160 } };
  const ivoryPurple = { id: 'ivory-purple', slot: 'companion', stats: { earth: 90, power: 70, vit: 400 } };
  const items = [kompost, { id: 'hat', slot: 'hat', stats: {} }, ivoryPurple];

  const ordered = preferCompanionVitalityOnTies(items);
  assert.equal(ordered[0].id, 'ivory-purple');
  assert.equal(ordered[1].id, 'hat');
  assert.equal(ordered[2].id, 'kompost');
});
