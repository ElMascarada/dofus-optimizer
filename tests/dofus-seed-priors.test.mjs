import test from 'node:test';
import assert from 'node:assert/strict';
import { coreOffensiveDofus, dofusSeedPrior, isCoreOffensiveDofus } from '../js/dofus-seed-priors.js';

test('offensive Dofus seed prior recognizes familiar core without forcing generic Dofus', () => {
  const nebuleux = { id: 'n', slot: 'dofus', name: 'Dofus Nébuleux' };
  const pourpre = { id: 'p', slot: 'dofus', name: 'Dofus Pourpre' };
  const turquoise = { id: 't', slot: 'dofus', name: 'Dofus Turquoise' };
  const glaces = { id: 'g', slot: 'dofus', name: 'Dofus des Glaces' };
  const random = { id: 'x', slot: 'dofus', name: 'Dofus utilitaire quelconque' };

  assert.ok(dofusSeedPrior(nebuleux) > dofusSeedPrior(pourpre));
  assert.ok(dofusSeedPrior(pourpre) > dofusSeedPrior(turquoise));
  assert.ok(dofusSeedPrior(turquoise) > 0);
  assert.ok(dofusSeedPrior(glaces) > 0);
  assert.equal(dofusSeedPrior(random), 0);
  assert.equal(isCoreOffensiveDofus(random), false);
});

test('core offensive Dofus list stays heuristic and leaves flex slots outside the core', () => {
  const items = [
    { id: 'ocre', slot: 'dofus', name: 'Dofus Ocre' },
    { id: 'vulbis', slot: 'dofus', name: 'Dofus Vulbis' },
    { id: 'prysma', slot: 'dofus', slotSubtype: 'prysmaradite', name: 'Prysmaradite test' },
    { id: 'turq', slot: 'dofus', name: 'Dofus Turquoise' },
    { id: 'neb', slot: 'dofus', name: 'Dofus Nébuleux' },
    { id: 'ice', slot: 'dofus', name: 'Dofus des Glaces' },
    { id: 'purp', slot: 'dofus', name: 'Dofus Pourpre' }
  ];

  assert.deepEqual(coreOffensiveDofus(items).map((item) => item.id), ['neb', 'purp', 'turq', 'ice']);
  assert.ok(dofusSeedPrior(items[0]) > 0);
  assert.ok(dofusSeedPrior(items[1]) > 0);
  assert.ok(dofusSeedPrior(items[2]) > 0);
});