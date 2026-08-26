import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSetCoreCatalog } from '../optimizer/set-core-catalog.js';
import { analyzeSetCoreCompatibility } from '../optimizer/set-core-compatibility.js';

function item(id, slot, setId, conditions = null) {
  return { id, name: id, level: 200, slot, setId, stats: {}, passives: [], conditions, certified: true };
}

const minimumEarth = { kind: 'condition', stat: 'earth', operator: 'gte', value: 300 };
const maximumEarth = { kind: 'condition', stat: 'earth', operator: 'lte', value: 200 };

test('compatibility analysis rejects contradictory core conditions', () => {
  const items = [
    item('a-hat', 'hat', 'a', minimumEarth), item('a-cape', 'cape', 'a'),
    item('b-belt', 'belt', 'b', maximumEarth), item('b-boots', 'boots', 'b')
  ];
  const sets = [
    { id: 'a', equipmentIds: ['a-hat', 'a-cape'], bonuses: { 2: { earth: 10 } } },
    { id: 'b', equipmentIds: ['b-belt', 'b-boots'], bonuses: { 2: { fire: 10 } } }
  ];
  const catalog = buildSetCoreCatalog({ items, sets, pruneDominated: false });
  const a = catalog.cores.find((core) => core.setId === 'a');
  const b = catalog.cores.find((core) => core.setId === 'b');
  const result = analyzeSetCoreCompatibility(a, b, { items, sets });
  assert.equal(result.compatible, false);
  assert.equal(result.conditions, 'incompatible');
  assert.ok(result.reasons.includes('condition-conflict:earth'));
});

test('compatibility analysis exposes compatible slots, conditions and set rules', () => {
  const items = [
    item('a-hat', 'hat', 'a'), item('a-cape', 'cape', 'a'),
    item('b-belt', 'belt', 'b'), item('b-boots', 'boots', 'b')
  ];
  const sets = [
    { id: 'a', equipmentIds: ['a-hat', 'a-cape'], bonuses: { 2: { earth: 10 } } },
    { id: 'b', equipmentIds: ['b-belt', 'b-boots'], bonuses: { 2: { fire: 10 } } }
  ];
  const catalog = buildSetCoreCatalog({ items, sets, pruneDominated: false });
  const a = catalog.cores.find((core) => core.setId === 'a');
  const b = catalog.cores.find((core) => core.setId === 'b');
  const result = analyzeSetCoreCompatibility(a, b, { items, sets });
  assert.equal(result.compatible, true);
  assert.equal(result.slots, 'compatible');
  assert.equal(result.conditions, 'compatible');
  assert.equal(result.setRules, 'compatible');
});
