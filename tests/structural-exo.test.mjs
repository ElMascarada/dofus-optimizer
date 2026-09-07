import test from 'node:test';
import assert from 'node:assert/strict';
import { optimizeFm } from '../js/fm.js';
import { statsForTurn } from '../js/spells.js';

const burstSpell = {
  id: 'burst',
  name: 'Burst',
  apCost: 5,
  baseCritPct: 0,
  hits: [{ element: 'fire', normal: [10, 10] }]
};

const selections = [{
  enabled: true,
  weight: 1,
  spell: burstSpell,
  casts: { 1: 3, 2: 0, 3: 0 }
}];

const prysmaradite = {
  id: 'prysma-ap',
  name: 'Prysmaradite AP',
  slot: 'dofus',
  slotSubtype: 'prysmaradite',
  stats: {},
  passives: [{
    id: 'ap-burst',
    rules: [{ trigger: { type: 'turn_in', turns: [1] }, stats: { ap: 3 } }]
  }]
};

test('11/5 native gear becomes permanent 12/6 with explicit structural exos, then temporary AP can reach 15 on T1', () => {
  const items = [
    { id: 'hat', name: 'Hat', slot: 'hat', stats: { fire: 100 } },
    { id: 'cape', name: 'Cape', slot: 'cape', stats: { fire: 100 } },
    prysmaradite
  ];
  const output = optimizeFm({
    baseStats: { ap: 11, mp: 5, fire: 200 },
    items,
    selections,
    policy: {
      spellDamagePct: 3,
      allowCritDamage: false,
      critDamageAmount: 8,
      structuralExos: true
    },
    turnMode: 't1'
  });

  assert.ok(output);
  assert.equal(output.stats.ap, 12);
  assert.equal(output.stats.mp, 6);
  assert.equal(statsForTurn(output.stats, items, 1).ap, 15);
  assert.equal(output.structuralExos, 2);
  assert.equal(output.spellPctItems, 2);
  assert.equal(output.assignments.filter((entry) => entry.type === 'exoAp').length, 0);
  assert.equal(output.assignments.filter((entry) => entry.type === 'exoMp').length, 0);
});
