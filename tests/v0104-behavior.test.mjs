import test from 'node:test';
import assert from 'node:assert/strict';
import { spellExpectedDamage } from '../js/spells.js';
import { prefilterItems } from '../js/candidate-prefilter.js';
import { optimizeBuild } from '../js/solver.js';

const earthSpell = {
  id: 'earth',
  name: 'Earth',
  baseCritPct: 0,
  hits: [{ element: 'earth', normal: [100, 100] }]
};
const selections = [{ enabled: true, weight: 1, spell: earthSpell, casts: { 1: 1 } }];
const noPoints = { level: 200, characteristicPoints: 0, scrolled: {}, baseStats: {} };
const fmPolicy = { spellDamagePct: 0, allowCritDamage: false, critDamageAmount: 8 };

test('melee and ranged damage stats do not influence spell scoring', () => {
  const stats = { earth: 100, meleeDamagePct: 500, rangedDamagePct: 900 };
  const melee = spellExpectedDamage({ ...earthSpell, distance: 'melee' }, stats, 1);
  const ranged = spellExpectedDamage({ ...earthSpell, distance: 'ranged' }, stats, 1);
  const neutral = spellExpectedDamage({ ...earthSpell }, stats, 1);
  assert.equal(melee, neutral);
  assert.equal(ranged, neutral);
});

test('seed prefilter can use a much tighter slot limit', () => {
  const items = Array.from({ length: 12 }, (_, index) => ({
    id: `d-${index}`,
    slot: 'dofus',
    stats: { earth: 120 - index }
  }));
  const result = prefilterItems({
    items,
    selections,
    constraints: {},
    slotRules: [{ id: 'dofus', count: 2 }],
    slotLimits: { dofus: 4 },
    maxRelevantSets: 1,
    constraintReservePerStat: 1
  });
  assert.equal(result.items.length, 4);
});

test('exact solver accepts valid seed results without duplicating them', () => {
  const items = [
    { id: 'h-best', name: 'Best', slot: 'hat', stats: { earth: 100 } },
    { id: 'h-other', name: 'Other', slot: 'hat', stats: { earth: 50 } }
  ];
  const common = {
    items,
    sets: [],
    selections,
    constraints: {},
    fmPolicy,
    slotRules: [{ id: 'hat', count: 1 }],
    character: noPoints,
    turnMode: 't1',
    topN: 1
  };
  const first = optimizeBuild(common);
  const seeded = optimizeBuild({ ...common, initialResults: first.results });
  assert.equal(seeded.diagnostics.seeded, 1);
  assert.equal(seeded.results.length, 1);
  assert.equal(seeded.results[0].items[0].id, 'h-best');
});
