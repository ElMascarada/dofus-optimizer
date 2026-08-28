import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  estimateExhaustiveCombinations,
  runExhaustiveOracle
} from './support/exhaustive-oracle.mjs';
import {
  compareHeuristicToOracle,
  oracleQualityLine
} from './support/oracle-quality.mjs';

const earthSpell = {
  id: 'oracle-earth',
  name: 'Oracle Earth',
  apCost: 3,
  baseCritPct: 0,
  hits: [{ element: 'earth', normal: [100, 100], crit: [100, 100] }]
};

const selections = [{
  enabled: true,
  weight: 1,
  spell: earthSpell,
  casts: { 1: 1, 2: 0, 3: 0 }
}];

const fmPolicy = {
  spellDamagePct: 0,
  allowCritDamage: false,
  critDamageAmount: 0,
  structuralExos: false
};

const baseConstraints = {
  ap: 12,
  mp: 6,
  range: 0,
  vit: 0,
  resEarth: 0,
  resFire: 0,
  resWater: 0,
  resAir: 0
};

const scenario = { requiredApByTurn: {} };

function item(id, slot, stats = {}, extra = {}) {
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
    typeName: slot === 'companion' ? 'Familier' : slot === 'dofus' ? 'Dofus' : slot,
    ...extra
  };
}

function fixedItems({ exclude = [] } = {}) {
  const excluded = new Set(exclude);
  const regular = [
    item('fixed-cape', 'cape', { ap: 1, earth: 20 }),
    item('fixed-amulet', 'amulet', { ap: 1, earth: 20 }),
    item('fixed-ring-a', 'ring', { earth: 20 }),
    item('fixed-ring-b', 'ring', { earth: 20 }),
    item('fixed-belt', 'belt', { earth: 20 }),
    item('fixed-boots', 'boots', { mp: 1, earth: 20 }),
    item('fixed-weapon', 'weapon', { ap: 1, earth: 20 }),
    item('fixed-shield', 'shield', { ap: 1, earth: 20 }),
    item('fixed-companion', 'companion', { mp: 1, earth: 20 })
  ].filter((entry) => !excluded.has(entry.slot));

  const dofus = Array.from({ length: 6 }, (_, index) => item(
    `fixed-dofus-${index + 1}`,
    'dofus',
    { power: 5 + index }
  ));
  return [...regular, ...dofus];
}

function compare(name, items, { constraints = baseConstraints, sets = [] } = {}) {
  return compareHeuristicToOracle({
    name,
    items,
    sets,
    selections,
    constraints,
    fmPolicy,
    turnMode: 't1',
    scenario,
    topN: 5,
    maxCombinations: 1000
  });
}

function ids(build) {
  return new Set((build?.items || []).map((entry) => String(entry.id)));
}

test('oracle dependency boundary excludes heuristic search machinery', () => {
  const source = readFileSync(new URL('./support/exhaustive-oracle.mjs', import.meta.url), 'utf8');
  for (const forbidden of [
    'candidate-policy.js',
    'candidate-prefilter.js',
    'candidate-search.js',
    'architecture-search-v2.js',
    'search-memory'
  ]) {
    assert.ok(!source.includes(forbidden), `oracle must not depend on ${forbidden}`);
  }
  assert.match(source, /complete-build-evaluator\.js/);
  assert.match(source, /build-legality\.js/);
});

test('oracle estimates the exact reduced search space and refuses oversized spaces before enumeration', () => {
  const base = fixedItems();
  const hats = Array.from({ length: 12 }, (_, index) => item(`guard-hat-${index}`, 'hat', { earth: index }));
  const estimate = estimateExhaustiveCombinations({ items: [...base, ...hats] });
  assert.equal(estimate.estimatedCombinations, 12);
  assert.equal(estimate.estimatedCombinationsExact, '12');

  assert.throws(
    () => runExhaustiveOracle({
      items: [...base, ...hats],
      selections,
      constraints: baseConstraints,
      fmPolicy,
      turnMode: 't1',
      scenario,
      maxCombinations: 10
    }),
    (error) => error?.code === 'ORACLE_SPACE_LIMIT_EXCEEDED'
      && error?.estimatedCombinations === 12
      && error?.maxCombinations === 10
  );
});

test('A — simple offense reaches the exact optimum', (t) => {
  const comparison = compare('A-simple-offense', [
    ...fixedItems(),
    item('offense-hat-weak', 'hat', { earth: 100 }),
    item('offense-hat-strong', 'hat', { earth: 260 })
  ]);

  t.diagnostic(oracleQualityLine(comparison));
  assert.equal(comparison.oracle.combinations, 2);
  assert.ok(ids(comparison.oracleBestBuild).has('offense-hat-strong'));
  assert.equal(comparison.exactOptimal, true);
  assert.equal(comparison.qualityRatio, 1);
});

test('B — positive Initiative constraint rejects the offensive glass cannon', (t) => {
  const comparison = compare('B-positive-constraint', [
    ...fixedItems(),
    item('constraint-glass-cannon', 'hat', { earth: 420 }),
    item('constraint-initiative', 'hat', { earth: 170, initiative: 1000 })
  ], {
    constraints: { ...baseConstraints, initiative: 1000 }
  });

  t.diagnostic(oracleQualityLine(comparison));
  assert.equal(comparison.oracle.combinations, 2);
  assert.equal(comparison.oracle.legal, 2);
  assert.equal(comparison.oracle.constraintValid, 1);
  assert.ok(ids(comparison.oracleBestBuild).has('constraint-initiative'));
  assert.ok(!ids(comparison.oracleBestBuild).has('constraint-glass-cannon'));
  assert.equal(comparison.oracleBestBuild.stats.initiative, 1000);
  assert.equal(comparison.exactOptimal, true);
});

test('C — signed Initiative keeps raw penalties meaningful while effective Initiative floors at zero', (t) => {
  const comparison = compare('C-signed-initiative', [
    ...fixedItems(),
    item('signed-positive-1000', 'hat', { earth: 100, initiative: 1000 }),
    item('signed-negative-1000', 'hat', { earth: 280, initiative: -1000 })
  ], {
    constraints: { ...baseConstraints, initiative: 0 }
  });

  t.diagnostic(oracleQualityLine(comparison));
  assert.equal(comparison.oracle.combinations, 2);
  assert.ok(ids(comparison.oracleBestBuild).has('signed-negative-1000'));
  assert.equal(comparison.oracleBestBuild.stats.initiative, 0);
  assert.equal(comparison.exactOptimal, true);
});

test('D — equipment condition is evaluated on the complete build, not the isolated item', (t) => {
  const conditional = item('conditional-mp-hat', 'hat', { earth: 300 }, {
    conditions: { kind: 'condition', stat: 'mp', operator: 'gte', value: 6 }
  });
  const comparison = compare('D-equipment-condition', [
    ...fixedItems(),
    item('condition-safe-hat', 'hat', { earth: 120 }),
    conditional
  ]);

  t.diagnostic(oracleQualityLine(comparison));
  assert.equal(comparison.oracle.combinations, 2);
  assert.equal(comparison.oracle.legal, 2);
  assert.ok(ids(comparison.oracleBestBuild).has('conditional-mp-hat'));
  assert.equal(comparison.oracleBestBuild.itemConditionsSatisfied, true);
});

test('E — set synergy beats individually stronger standalone pieces', (t) => {
  const setId = 'oracle-set';
  const items = [
    ...fixedItems({ exclude: ['cape'] }),
    item('standalone-hat', 'hat', { earth: 180 }),
    item('set-hat', 'hat', { earth: 110 }, { setId }),
    item('standalone-cape', 'cape', { ap: 1, earth: 180 }),
    item('set-cape', 'cape', { ap: 1, earth: 110 }, { setId })
  ];
  const sets = [{
    id: setId,
    name: 'Oracle Set',
    bonuses: { '2': { earth: 260 } },
    equipmentIds: ['set-hat', 'set-cape']
  }];
  const comparison = compare('E-set-synergy', items, { sets });

  t.diagnostic(oracleQualityLine(comparison));
  assert.equal(comparison.oracle.combinations, 4);
  const bestIds = ids(comparison.oracleBestBuild);
  assert.ok(bestIds.has('set-hat'));
  assert.ok(bestIds.has('set-cape'));
  assert.equal(comparison.oracleBestBuild.activeSets[0]?.setId, setId);
});
