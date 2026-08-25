import test from 'node:test';
import assert from 'node:assert/strict';
import { searchArchitecturesV2 } from '../js/architecture-search-v2.js';

function item(id, slot, stats = {}) {
  return { id, name: id, slot, stats, passives: [], conditions: null };
}

const spell = {
  id: 'multi-hit',
  name: 'Multi hit',
  apCost: 3,
  baseCritPct: 0,
  hits: [
    { element: 'earth', normal: [20, 20], crit: [20, 20] },
    { element: 'fire', normal: [20, 20], crit: [20, 20] },
    { element: 'water', normal: [20, 20], crit: [20, 20] },
    { element: 'air', normal: [20, 20], crit: [20, 20] }
  ]
};

function fixtureItems() {
  const items = [];

  // These offensive decoys are intentionally much stronger for damage. A
  // purely offensive slot shortlist would discard the two pieces that are
  // necessary to reach the user's 45% fire-resistance constraint.
  for (let index = 0; index < 24; index++) {
    items.push(item(`hat-offense-${index}`, 'hat', { power: 250 + index }));
    items.push(item(`cape-offense-${index}`, 'cape', { power: 250 + index }));
  }
  items.push(item('hat-fire-res', 'hat', { resFire: 30, power: 5 }));
  items.push(item('cape-fire-res', 'cape', { resFire: 15, power: 5 }));

  items.push(item('amulet', 'amulet', { power: 10 }));
  items.push(item('ring-1', 'ring', { power: 10 }));
  items.push(item('ring-2', 'ring', { power: 10 }));
  items.push(item('belt', 'belt', { power: 10 }));
  items.push(item('boots', 'boots', { power: 10 }));
  items.push(item('weapon', 'weapon', { power: 10 }));
  items.push(item('shield', 'shield', { power: 10 }));
  items.push(item('companion', 'companion', { power: 10 }));
  for (let index = 0; index < 6; index++) items.push(item(`dofus-${index}`, 'dofus', { power: 1 }));
  return items;
}

test('a strong resistance constraint keeps defensive gear alive instead of returning a false impossible result', () => {
  const selection = { enabled: true, weight: 1, spell, casts: { 1: 1, 2: 1, 3: 1 } };
  const output = searchArchitecturesV2({
    items: fixtureItems(),
    sets: [],
    selections: [selection],
    constraints: { resFire: 45 },
    fmPolicy: { spellDamagePct: 0, allowCritDamage: false, structuralExos: false },
    turnMode: 't1',
    topN: 5
  });

  assert.ok(output.results.length > 0, `expected a valid 45% fire-resistance build, diagnostics: ${JSON.stringify(output.diagnostics)}`);
  assert.equal(output.diagnostics.extraConstraintSearch, true);
  for (const build of output.results) {
    assert.ok(build.stats.resFire >= 45, `expected >=45 fire resistance, got ${build.stats.resFire}`);
    const ids = new Set(build.items.map((entry) => entry.id));
    assert.ok(ids.has('hat-fire-res'));
    assert.ok(ids.has('cape-fire-res'));
  }
});
