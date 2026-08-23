import test from 'node:test';
import assert from 'node:assert/strict';
import { buildParetoChoices } from '../js/pareto-choices.js';

test('Pareto builder removes dominated six-slot combinations without changing the best vector', () => {
  const items = Array.from({ length: 12 }, (_, index) => ({
    id: `d${index}`,
    slot: 'dofus',
    stats: { power: index + 1, resEarth: index + 1 }
  }));
  const output = buildParetoChoices(items, 6, ['power', 'resEarth']);
  assert.equal(output.diagnostics.aborted, false);
  assert.equal(output.choices.length, 1);
  assert.equal(output.choices[0].stats.power, 57);
  assert.equal(output.choices[0].stats.resEarth, 57);
  assert.deepEqual(output.choices[0].items.map((item) => item.id), ['d6', 'd7', 'd8', 'd9', 'd10', 'd11']);
});

test('different equipment conditions remain separate Pareto structures', () => {
  const unrestricted = { id: 'a', slot: 'dofus', stats: { power: 100 } };
  const trophy = {
    id: 'b',
    slot: 'dofus',
    stats: { power: 90 },
    conditions: { kind: 'condition', stat: 'setBonus', operator: 'lt', value: 2 }
  };
  const output = buildParetoChoices([unrestricted, trophy], 1, ['power']);
  assert.equal(output.choices.length, 2);
});

test('Prysmaradite rule is enforced while building a multi-slot frontier', () => {
  const items = [
    { id: 'p1', slot: 'dofus', slotSubtype: 'prysmaradite', stats: { power: 100 } },
    { id: 'p2', slot: 'dofus', slotSubtype: 'prysmaradite', stats: { power: 90 } },
    { id: 'd1', slot: 'dofus', stats: { power: 10 } }
  ];
  const output = buildParetoChoices(items, 2, ['power']);
  assert.ok(output.choices.length > 0);
  assert.equal(output.choices.some((choice) => choice.items.filter((item) => item.slotSubtype === 'prysmaradite').length > 1), false);
});
