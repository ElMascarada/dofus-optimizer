import test from 'node:test';
import assert from 'node:assert/strict';

import { createCombatMechanicRegistry } from '../js/combat-mechanics-registry.js';

test('combat mechanic registry matches declarative ids and tags', () => {
  const registry = createCombatMechanicRegistry([
    { id: 'element-state', matcher: { breedIds: [17], tags: ['elemental'] }, transitions: [] },
    { id: 'charge-state', matcher: { spellIds: ['spell-1'] }, transitions: [] }
  ]);

  assert.deepEqual(registry.matching({ breedId: 17, tags: ['elemental'] }).map((entry) => entry.id), ['element-state']);
  assert.deepEqual(registry.matching({ spellId: 'spell-1' }).map((entry) => entry.id), ['charge-state']);
  assert.deepEqual(registry.matching({ breedId: 8, tags: ['elemental'] }), []);
});

test('combat mechanic registry rejects duplicate definitions', () => {
  assert.throws(() => createCombatMechanicRegistry([{ id: 'same' }, { id: 'same' }]), /Duplicate combat mechanic id/);
});
