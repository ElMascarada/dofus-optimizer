import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHardConstraintChoices } from '../js/hard-constraint-choices.js';

test('hard-constraint frontier keeps legal multi-pick tradeoffs instead of the full combination space', () => {
  const candidates = [
    { id: 'earth', slot: 'dofus', stats: { resEarth: 40 } },
    { id: 'fire', slot: 'dofus', stats: { resFire: 40 } },
    { id: 'balanced', slot: 'dofus', stats: { resEarth: 20, resFire: 20 } },
    { id: 'weak', slot: 'dofus', stats: { resEarth: 5, resFire: 5 } }
  ];
  const output = buildHardConstraintChoices(candidates, 2, { resEarth: 40, resFire: 40 });
  assert.equal(output.diagnostics.skipped, false);
  assert.ok(output.choices.length > 0);
  assert.ok(output.diagnostics.generated > 0);
  assert.ok(output.choices.length <= 6); // C(4,2): never exceed the full theoretical pair space.
  assert.ok(output.choices.some((choice) =>
    Number(choice.stats.resEarth || 0) >= 40 && Number(choice.stats.resFire || 0) >= 40
  ));
});

test('hard-constraint frontier is skipped when the user did not request any minimum', () => {
  const output = buildHardConstraintChoices([
    { id: 'a', slot: 'dofus', stats: { power: 100 } },
    { id: 'b', slot: 'dofus', stats: { power: 90 } }
  ], 2, {});
  assert.equal(output.diagnostics.skipped, true);
  assert.deepEqual(output.choices, []);
});