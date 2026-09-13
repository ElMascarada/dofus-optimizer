import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { buildDofusPackageFrontier } from '../optimizer/dofus-package-refiner.js';

function dofus(id, name, stats = {}) {
  return {
    id,
    name,
    level: 200,
    slot: 'dofus',
    typeName: 'Dofus',
    slotSubtype: null,
    setId: null,
    stats,
    passives: [],
    conditions: null
  };
}

const multi = {
  elements: ['multi'],
  profiles: ['small'],
  critMode: 'auto'
};

test('Pourpre removes the strictly dominated Robuste-only package in Auto', () => {
  const pool = [
    dofus('robuste', 'Robuste majeur', { power: 80, crit: -12 }),
    dofus('pourpre', 'Dofus Pourpre', { power: 80 }),
    dofus('a', 'A', { damageEarth: 5 }),
    dofus('b', 'B', { damageFire: 5 }),
    dofus('c', 'C', { damageWater: 5 }),
    dofus('d', 'D', { damageAir: 5 }),
    dofus('e', 'E', { critDamage: 5 })
  ];

  const frontier = buildDofusPackageFrontier(pool, { syntheticOffense: multi });
  const robustOnly = frontier.packages.find((pack) => {
    const ids = new Set(pack.items.map((item) => item.id));
    return ids.has('robuste') && !ids.has('pourpre');
  });
  const pourpreOnly = frontier.packages.find((pack) => {
    const ids = new Set(pack.items.map((item) => item.id));
    return ids.has('pourpre') && !ids.has('robuste');
  });

  assert.equal(robustOnly, undefined, 'Robuste-only package is strictly dominated by the Pourpre replacement');
  assert.ok(pourpreOnly, 'the dominating Pourpre package must survive the frontier');
});

test('Ocre and Vulbis resource signatures cannot be pruned by pure offense', () => {
  const pool = [
    dofus('ocre', 'Dofus Ocre', { ap: 1 }),
    dofus('vulbis', 'Dofus Vulbis', { mp: 1 }),
    dofus('pourpre', 'Dofus Pourpre', { power: 80 }),
    dofus('ddg', 'Dofus des Glaces', { damageEarth: 25, damageFire: 25, damageWater: 25, damageAir: 25 }),
    dofus('a', 'A', { power: 40 }),
    dofus('b', 'B', { crit: 10 }),
    dofus('c', 'C', { critDamage: 20 }),
    dofus('d', 'D', { spellDamagePct: 3 })
  ];

  const frontier = buildDofusPackageFrontier(pool, { syntheticOffense: multi });
  const structural = frontier.packages.filter((pack) => {
    const ids = new Set(pack.items.map((item) => item.id));
    return ids.has('ocre') && ids.has('vulbis');
  });

  assert.equal(frontier.combinations, 28);
  assert.ok(structural.length > 0, 'at least one Ocre+Vulbis package must survive its AP/MP resource bucket');
  assert.ok(structural.every((pack) => pack.ap === 1 && pack.mp === 1));
});

test('combined request path performs exact Dofus refinement after native search', () => {
  const source = readFileSync(new URL('../js/equipment-search-request.js', import.meta.url), 'utf8');
  assert.match(source, /refineDofusPackagesForResults/);
  assert.match(source, /exactDofusRefine/);
  assert.match(source, /Math\.max\(resultLimit, 160\)/);
});
