import test from 'node:test';
import assert from 'node:assert/strict';

import { buildCandidatePools } from '../optimizer/candidate-policy.js';
import {
  areSetCoresCompatible,
  buildSetCoreCatalog
} from '../optimizer/set-core-catalog.js';
import { searchArchitecturesV2 } from '../js/architecture-search-v2.js';

const fireSpell = {
  id: 'set-core-fire',
  name: 'Set Core Fire',
  apCost: 3,
  baseCritPct: 0,
  maxCastPerTurn: 3,
  maxCastPerTarget: 3,
  distanceOptions: ['melee', 'ranged'],
  hits: [{ element: 'fire', normal: [40, 40], crit: [40, 40] }],
  combatModifiers: [],
  combatRelevant: true
};

const selections = [{
  enabled: true,
  weight: 1,
  spell: fireSpell,
  casts: { 1: 1, 2: 0, 3: 0 }
}];

const baseConstraints = {
  ap: 8,
  mp: 4,
  range: 0,
  vit: 0,
  resEarth: 0,
  resFire: 0,
  resWater: 0,
  resAir: 0
};

const fmPolicy = {
  spellDamagePct: 0,
  allowCritDamage: false,
  critDamageAmount: 8,
  structuralExos: false
};

function item(id, slot, stats = {}, setId = null, extra = {}) {
  return {
    id,
    name: id,
    level: 200,
    slot,
    setId,
    stats,
    passives: [],
    effects: [],
    conditions: null,
    turnBonuses: {},
    pendingDynamicEffects: [],
    slotSubtype: null,
    typeName: slot === 'companion' ? 'Familier' : slot === 'dofus' ? 'Dofus' : slot,
    certified: true,
    ...extra
  };
}

function completeFixture({ hats = [], capes = [] } = {}) {
  return [
    ...hats,
    ...capes,
    item('fixed-amulet', 'amulet', { fire: 20 }),
    item('fixed-ring-a', 'ring', { fire: 20 }),
    item('fixed-ring-b', 'ring', { fire: 19 }),
    item('fixed-belt', 'belt', { fire: 20 }),
    item('fixed-boots', 'boots', { fire: 20 }),
    item('fixed-weapon', 'weapon', { fire: 20 }),
    item('fixed-shield', 'shield', { fire: 20 }),
    item('fixed-pet', 'companion', { fire: 20 }),
    ...Array.from({ length: 6 }, (_, index) => item(`fixed-dofus-${index}`, 'dofus', { fire: 5 }))
  ];
}

function search(items, sets) {
  return searchArchitecturesV2({
    items,
    sets,
    selections,
    constraints: baseConstraints,
    fmPolicy,
    turnMode: 't1',
    scenario: {},
    topN: 10,
    searchProfile: 'FAST'
  });
}

function ids(result) {
  return new Set((result?.items || []).map((entry) => String(entry.id)));
}

// 1. bonus 2 pièces correctement calculé
test('SetCoreCatalog includes the exact two-piece set bonus in aggregate stats', () => {
  const items = [
    item('two-hat', 'hat', { fire: 40 }, 'two-set'),
    item('two-cape', 'cape', { fire: 30 }, 'two-set')
  ];
  const sets = [{ id: 'two-set', name: 'Two Set', bonuses: { '2': { fire: 80, crit: 4 } } }];
  const catalog = buildSetCoreCatalog({ items, sets });
  const core = catalog.cores.find((entry) => entry.pieceCount === 2);

  assert.ok(core);
  assert.equal(core.aggregateStats.fire, 150);
  assert.equal(core.aggregateStats.crit, 4);
  assert.deepEqual(core.setBonuses, { fire: 80, crit: 4 });
});

// 2. bonus 3 pièces correctement calculé
test('SetCoreCatalog includes the exact three-piece set bonus in aggregate stats', () => {
  const items = [
    item('three-hat', 'hat', { fire: 20 }, 'three-set'),
    item('three-cape', 'cape', { fire: 25 }, 'three-set'),
    item('three-belt', 'belt', { fire: 30 }, 'three-set')
  ];
  const sets = [{
    id: 'three-set',
    name: 'Three Set',
    bonuses: { '2': { fire: 40 }, '3': { fire: 120, ap: 1 } }
  }];
  const catalog = buildSetCoreCatalog({ items, sets });
  const core = catalog.cores.find((entry) => entry.pieceCount === 3);

  assert.ok(core);
  assert.equal(core.aggregateStats.fire, 195);
  assert.equal(core.aggregateStats.ap, 1);
  assert.deepEqual(core.setBonuses, { fire: 120, ap: 1 });
});

// 3. slots incompatibles rejetés
test('two cores that overflow unique slots are incompatible', () => {
  const items = [
    item('a-hat', 'hat', { fire: 40 }, 'set-a'),
    item('a-cape', 'cape', { fire: 40 }, 'set-a'),
    item('b-hat', 'hat', { fire: 40 }, 'set-b'),
    item('b-cape', 'cape', { fire: 40 }, 'set-b')
  ];
  const sets = [
    { id: 'set-a', name: 'A', bonuses: { '2': { fire: 20 } } },
    { id: 'set-b', name: 'B', bonuses: { '2': { fire: 20 } } }
  ];
  const catalog = buildSetCoreCatalog({ items, sets });
  const a = catalog.forSet('set-a')[0];
  const b = catalog.forSet('set-b')[0];
  const compatibility = areSetCoresCompatible(a, b);

  assert.equal(compatibility.compatible, false);
  assert.ok(compatibility.reasons.some((reason) => reason === 'slot:hat' || reason === 'slot:cape'));
});

// 4. core offensif conservé
test('an offensive core preserves individually weak members through Candidate Policy', () => {
  const coreHat = item('core-off-hat', 'hat', { fire: 5 }, 'off-set');
  const coreCape = item('core-off-cape', 'cape', { fire: 5 }, 'off-set');
  const items = [
    coreHat,
    coreCape,
    ...Array.from({ length: 30 }, (_, index) => item(`hat-off-${index}`, 'hat', { fire: 200 - index })),
    ...Array.from({ length: 30 }, (_, index) => item(`cape-off-${index}`, 'cape', { fire: 200 - index }))
  ];
  const sets = [{ id: 'off-set', name: 'Off Set', bonuses: { '2': { fire: 600 } } }];
  const output = buildCandidatePools({
    items,
    sets,
    selections,
    constraints: baseConstraints,
    turnMode: 't1',
    scenario: {},
    searchProfile: 'FAST'
  });

  assert.ok(output.pools.hat.some((entry) => entry.id === coreHat.id));
  assert.ok(output.pools.cape.some((entry) => entry.id === coreCape.id));
  const hatDiagnostics = output.diagnostics.slots.find((slot) => slot.id === 'hat');
  const capeDiagnostics = output.diagnostics.slots.find((slot) => slot.id === 'cape');
  assert.ok(hatDiagnostics.reasons[coreHat.id]?.includes('set-core'));
  assert.ok(capeDiagnostics.reasons[coreCape.id]?.includes('set-core'));
});

// 5. core utile à une contrainte conservé
test('a core useful only for a hard constraint is preserved', () => {
  const coreHat = item('core-range-hat', 'hat', { fire: 1 }, 'range-set');
  const coreCape = item('core-range-cape', 'cape', { fire: 1 }, 'range-set');
  const items = [
    coreHat,
    coreCape,
    ...Array.from({ length: 25 }, (_, index) => item(`range-hat-${index}`, 'hat', { fire: 180 - index })),
    ...Array.from({ length: 25 }, (_, index) => item(`range-cape-${index}`, 'cape', { fire: 180 - index }))
  ];
  const sets = [{ id: 'range-set', name: 'Range Set', bonuses: { '2': { range: 3 } } }];
  const output = buildCandidatePools({
    items,
    sets,
    selections,
    constraints: { ...baseConstraints, range: 3 },
    turnMode: 't1',
    scenario: {},
    searchProfile: 'FAST'
  });

  assert.ok(output.pools.hat.some((entry) => entry.id === coreHat.id));
  assert.ok(output.pools.cape.some((entry) => entry.id === coreCape.id));
  assert.ok(output.diagnostics.relevantCores > 0);
  assert.ok(output.diagnostics.topSetPlans[0].whySelected.includes('helps range constraint'));
});

// 6. core réellement dominé éliminé
test('a truly dominated core with identical occupied slots is removed', () => {
  const items = [
    item('strong-hat', 'hat', { fire: 100, vit: 100 }, 'dom-set'),
    item('weak-hat', 'hat', { fire: 20, vit: 20 }, 'dom-set'),
    item('shared-cape', 'cape', { fire: 50, vit: 50 }, 'dom-set')
  ];
  const sets = [{ id: 'dom-set', name: 'Dominance Set', bonuses: { '2': { fire: 20 } } }];
  const catalog = buildSetCoreCatalog({ items, sets });
  const twoPiece = catalog.forSet('dom-set').filter((core) => core.pieceCount === 2);

  assert.equal(twoPiece.length, 1);
  assert.ok(twoPiece[0].itemIds.includes('strong-hat'));
  assert.ok(!twoPiece[0].itemIds.includes('weak-hat'));
  assert.equal(catalog.diagnostics.eliminatedDominance, 1);
});

// 7. build standalone toujours trouvable
test('hybrid search keeps a strong full-standalone build reachable', () => {
  const badHat = item('bad-set-hat', 'hat', { fire: 1 }, 'bad-set');
  const badCape = item('bad-set-cape', 'cape', { fire: 1 }, 'bad-set');
  const standaloneHat = item('standalone-hat', 'hat', { fire: 260 });
  const standaloneCape = item('standalone-cape', 'cape', { fire: 250 });
  const items = completeFixture({ hats: [badHat, standaloneHat], capes: [badCape, standaloneCape] });
  const sets = [{ id: 'bad-set', name: 'Bad Set', bonuses: { '2': { fire: 2 } } }];
  const output = search(items, sets);
  const bestIds = ids(output.results[0]);

  assert.ok(output.results.length > 0);
  assert.ok(bestIds.has('standalone-hat'));
  assert.ok(bestIds.has('standalone-cape'));
  assert.ok(Number(output.diagnostics.evaluatedByOrigin.standalone) > 0);
});

// 8. set-core peut battre standalone
test('a set core can beat individually stronger standalone pieces through its real bonus', () => {
  const coreHat = item('winner-core-hat', 'hat', { fire: 90 }, 'winner-set');
  const coreCape = item('winner-core-cape', 'cape', { fire: 90 }, 'winner-set');
  const standaloneHat = item('weaker-combo-hat', 'hat', { fire: 180 });
  const standaloneCape = item('weaker-combo-cape', 'cape', { fire: 175 });
  const items = completeFixture({ hats: [coreHat, standaloneHat], capes: [coreCape, standaloneCape] });
  const sets = [{ id: 'winner-set', name: 'Winner Set', bonuses: { '2': { fire: 350 } } }];
  const output = search(items, sets);
  const bestIds = ids(output.results[0]);

  assert.ok(bestIds.has(coreHat.id));
  assert.ok(bestIds.has(coreCape.id));
  assert.ok(output.results[0].activeSets.some((entry) => entry.setId === 'winner-set' && entry.count === 2));
  assert.ok(Number(output.diagnostics.validByOrigin['set-core']) > 0);
});

// 9. standalone peut battre set-core
test('standalone remains free to beat a legal but mediocre set core', () => {
  const coreHat = item('mediocre-core-hat', 'hat', { fire: 60 }, 'mediocre-set');
  const coreCape = item('mediocre-core-cape', 'cape', { fire: 60 }, 'mediocre-set');
  const standaloneHat = item('best-free-hat', 'hat', { fire: 300 });
  const standaloneCape = item('best-free-cape', 'cape', { fire: 290 });
  const items = completeFixture({ hats: [coreHat, standaloneHat], capes: [coreCape, standaloneCape] });
  const sets = [{ id: 'mediocre-set', name: 'Mediocre Set', bonuses: { '2': { fire: 20 } } }];
  const output = search(items, sets);
  const bestIds = ids(output.results[0]);

  assert.ok(bestIds.has(standaloneHat.id));
  assert.ok(bestIds.has(standaloneCape.id));
  assert.ok(!bestIds.has(coreHat.id));
  assert.ok(!bestIds.has(coreCape.id));
});

// 10. aucune régression sur la voie libre quand aucun set n'existe
test('empty set catalog preserves standalone-only search behavior', () => {
  const items = completeFixture({
    hats: [item('plain-hat', 'hat', { fire: 200 })],
    capes: [item('plain-cape', 'cape', { fire: 190 })]
  });
  const output = search(items, []);

  assert.ok(output.results.length > 0);
  assert.equal(output.diagnostics.setCores.retained, 0);
  assert.equal(output.diagnostics.setCores.injected, 0);
  assert.ok(Number(output.diagnostics.evaluatedByOrigin.standalone) > 0);
  assert.deepEqual(output.diagnostics.searchModes, ['set-core', 'standalone']);
});
