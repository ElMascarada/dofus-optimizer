import test from 'node:test';
import assert from 'node:assert/strict';

import { searchArchitecturesV2 } from '../js/architecture-search-v2.js';
import { withCandidateOverrides } from '../optimizer/search-profiles.js';

function gear(id, slot, stats = {}, extra = {}) {
  return {
    id,
    name: id,
    level: 200,
    slot,
    setId: null,
    stats,
    passives: [],
    conditions: null,
    slotSubtype: null,
    typeName: slot === 'dofus' ? 'Dofus' : slot,
    certified: true,
    ...extra
  };
}

const earthSpell = {
  id: 'earth-hit',
  name: 'earth-hit',
  apCost: 4,
  baseCritPct: 0,
  maxCastPerTurn: 3,
  maxCastPerTarget: 3,
  distanceOptions: ['melee', 'ranged'],
  hits: [{ element: 'earth', normal: [50, 50], crit: [50, 50] }],
  combatModifiers: [],
  combatRelevant: true
};
const selections = [{ spell: earthSpell, enabled: true, weight: 1, casts: { 1: 1, 2: 0, 3: 0 } }];
const fmPolicy = { spellDamagePct: 0, allowCritDamage: false, structuralExos: false };
const searchProfile = withCandidateOverrides('FAST', {
  maxSetCorePlans: 4,
  slotPoolTargets: {
    hat: 1, cape: 1, amulet: 1, ring: 2, belt: 1, boots: 1,
    weapon: 1, shield: 1, companion: 1, dofus: 6
  }
});

function commonItems() {
  return [
    gear('amulet', 'amulet', { earth: 20 }),
    gear('ring-a', 'ring', { earth: 20 }), gear('ring-b', 'ring', { earth: 20 }),
    gear('belt', 'belt', { earth: 20 }), gear('boots', 'boots', { earth: 20 }),
    gear('weapon', 'weapon', { earth: 20 }), gear('shield', 'shield', { earth: 20 }),
    gear('companion', 'companion', { earth: 20 }),
    ...Array.from({ length: 6 }, (_, index) => gear(`dofus-${index}`, 'dofus', { earth: 5 }))
  ];
}

function runHybrid({ setPieceEarth, standaloneEarth, setBonusEarth, enableSetCores = true, topN = 5 }) {
  const items = [
    gear('plain-hat', 'hat', { earth: standaloneEarth }),
    gear('plain-cape', 'cape', { earth: standaloneEarth }),
    gear('core-hat', 'hat', { earth: setPieceEarth }, { setId: 'burst' }),
    gear('core-cape', 'cape', { earth: setPieceEarth }, { setId: 'burst' }),
    ...commonItems()
  ];
  const sets = [{
    id: 'burst',
    name: 'Burst',
    equipmentIds: ['core-hat', 'core-cape'],
    bonuses: { 2: { earth: setBonusEarth } }
  }];
  const output = searchArchitecturesV2({
    items,
    sets,
    selections,
    constraints: {},
    fmPolicy,
    turnMode: 't1',
    scenario: { enableSetCores },
    topN,
    searchProfile
  });
  return { output, items, sets };
}

function ids(result) {
  return new Set((result?.items || []).map((item) => item.id));
}

test('hybrid search always keeps a standalone path when set cores are available', () => {
  const { output } = runHybrid({ setPieceEarth: 20, standaloneEarth: 180, setBonusEarth: 250, topN: 5 });
  assert.ok(output.results.length > 0);
  assert.ok(output.results.some((result) => {
    const selected = ids(result);
    return selected.has('plain-hat') && selected.has('plain-cape') && !selected.has('core-hat') && !selected.has('core-cape');
  }));
});

test('set-core search can beat a standalone-only baseline when the real set bonus matters', () => {
  const withCores = runHybrid({ setPieceEarth: 20, standaloneEarth: 180, setBonusEarth: 700, enableSetCores: true, topN: 3 }).output;
  const standaloneOnly = runHybrid({ setPieceEarth: 20, standaloneEarth: 180, setBonusEarth: 700, enableSetCores: false, topN: 3 }).output;
  assert.ok(withCores.results[0] && standaloneOnly.results[0]);
  assert.ok(withCores.results[0].score > standaloneOnly.results[0].score);
  const selected = ids(withCores.results[0]);
  assert.ok(selected.has('core-hat') && selected.has('core-cape'));
});

test('standalone build can beat set-core seeds and remains the winner', () => {
  const { output } = runHybrid({ setPieceEarth: 5, standaloneEarth: 260, setBonusEarth: 20, enableSetCores: true, topN: 3 });
  assert.ok(output.results[0]);
  const selected = ids(output.results[0]);
  assert.ok(selected.has('plain-hat') && selected.has('plain-cape'));
  assert.ok(!selected.has('core-hat') && !selected.has('core-cape'));
});
