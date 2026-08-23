import test from 'node:test';
import assert from 'node:assert/strict';
import { optimizeBuild } from '../js/solver.js';

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

test('11/5 native gear becomes permanent 12/6 with PA/PM exos, then temporary AP can reach 15 on T1', () => {
  const output = optimizeBuild({
    items: [
      { id: 'hat', name: 'Hat', slot: 'hat', stats: { fire: 100 } },
      { id: 'cape', name: 'Cape', slot: 'cape', stats: { fire: 100 } },
      prysmaradite
    ],
    sets: [],
    selections,
    constraints: { ap: 12, mp: 6 },
    fmPolicy: {
      spellDamagePct: 3,
      allowCritDamage: false,
      critDamageAmount: 8,
      structuralExos: true
    },
    turnMode: 't1',
    slotRules: [
      { id: 'hat', count: 1 },
      { id: 'cape', count: 1 },
      { id: 'dofus', count: 1 }
    ],
    character: {
      level: 200,
      characteristicPoints: 0,
      scrolled: {},
      baseStats: { ap: 11, mp: 5 }
    },
    topN: 1
  });

  assert.equal(output.results.length, 1);
  const build = output.results[0];
  assert.equal(build.stats.ap, 12);
  assert.equal(build.stats.mp, 6);
  assert.equal(build.effectiveStatsByTurn[1].ap, 15);
  assert.equal(build.fm.structuralExos, 2);
  assert.equal(build.fm.assignments.filter((entry) => entry.type === 'exoAp').length, 1);
  assert.equal(build.fm.assignments.filter((entry) => entry.type === 'exoMp').length, 1);
});
