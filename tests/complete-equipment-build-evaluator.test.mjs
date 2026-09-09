import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  compareCompleteEquipmentBuildResults,
  completeEquipmentBuildIdentity,
  evaluateCompleteEquipmentBuild
} from '../js/complete-equipment-build-evaluator.js';

const REQUEST = { elements: ['earth'], profiles: ['small', 'large'] };

function character({ ap = 7, mp = 3, vit = 1000, points = 0, scrolled = {} } = {}) {
  return { level: 200, characteristicPoints: points, scrolled, baseStats: { ap, mp, vit } };
}

function completeItems({ stats = {}, condition = null, setId = null, idPrefix = 'item' } = {}) {
  const slots = [
    'hat', 'cape', 'amulet', 'ring', 'ring', 'belt', 'boots', 'weapon', 'shield', 'companion',
    'dofus', 'dofus', 'dofus', 'dofus', 'dofus', 'dofus'
  ];
  return slots.map((slot, index) => ({
    id: `${idPrefix}-${String(index).padStart(2, '0')}`,
    slot,
    stats: index === 0 ? { ...stats } : {},
    conditions: index === 0 ? condition : null,
    setId: index === 3 || index === 4 ? setId : null
  }));
}

function evaluate({ items, sets = [], constraints = {}, fmPolicy = {}, syntheticOffense = REQUEST, char = character() }) {
  return evaluateCompleteEquipmentBuild({ items, sets, constraints, fmPolicy, syntheticOffense, character: char });
}

function score(evaluation) {
  return evaluation.result.syntheticOffense.minimumScore;
}

test('legal complete equipment build needs no class, spells, selections or turn mode', async () => {
  const evaluation = evaluate({ items: completeItems({ stats: { ap: 5, mp: 3, earth: 100 } }) });
  assert.ok(evaluation.result);
  assert.equal(evaluation.reason, null);
  assert.equal(evaluation.result.syntheticApBudget, 12);
  const source = await readFile(new URL('../js/complete-equipment-build-evaluator.js', import.meta.url), 'utf8');
  for (const forbidden of ['spells.js', 'turn-optimizer', 'combat-turn-refiner', 'CombatState', 'spellBreakdowns', 'perTurn']) {
    assert.equal(source.includes(forbidden), false, `forbidden dependency: ${forbidden}`);
  }
  assert.equal(/classId|className|breedId|turnMode|selections/.test(source), false);
});

test('actual permanent AP, not requested minimum, is the synthetic budget', () => {
  const eleven = evaluate({
    items: completeItems({ stats: { ap: 4, mp: 3, earth: 100 }, idPrefix: 'eleven' }),
    constraints: { ap: 11 }
  });
  const twelve = evaluate({
    items: completeItems({ stats: { ap: 5, mp: 3, earth: 100 }, idPrefix: 'twelve' }),
    constraints: { ap: 11 }
  });
  assert.equal(eleven.result.syntheticApBudget, 11);
  assert.equal(twelve.result.syntheticApBudget, 12);
  assert.ok(score(twelve) > score(eleven));
});

test('set bonuses are applied before synthetic offense', () => {
  const items = completeItems({ stats: { ap: 5, mp: 3 }, setId: 'set-a' });
  const without = evaluate({ items });
  const withSet = evaluate({ items, sets: [{ id: 'set-a', name: 'Set A', bonuses: { '2': { earth: 100 } } }] });
  assert.equal(withSet.result.activeSets.length, 1);
  assert.equal(withSet.result.activeSets[0].count, 2);
  assert.ok(score(withSet) > score(without));
});

test('item conditions are repaired by characteristics when possible and rejected otherwise', () => {
  const investable = completeItems({
    stats: { ap: 5, mp: 3 },
    condition: { kind: 'condition', stat: 'earth', operator: 'gte', value: 5 }
  });
  const repaired = evaluate({
    items: investable,
    char: character({ points: 6 }),
    syntheticOffense: { elements: ['water'], profiles: ['small'] }
  });
  assert.ok(repaired.result);
  assert.ok(repaired.result.characteristics.earth >= 5);
  assert.equal(repaired.result.itemConditionsSatisfied, true);

  const impossible = completeItems({
    stats: { ap: 5, mp: 3 },
    condition: { kind: 'condition', stat: 'level', operator: 'gte', value: 201 }
  });
  assert.equal(evaluate({ items: impossible }).reason, 'item-condition');
});

test('structural AP and MP exos add exactly one permanent resource', () => {
  const items = completeItems({ stats: { ap: 4, mp: 2, earth: 100 } });
  const base = evaluate({ items });
  const ap = evaluate({ items, fmPolicy: { exoAp: 1 } });
  const mp = evaluate({ items, fmPolicy: { exoMp: 1 } });
  assert.equal(ap.result.stats.ap, base.result.stats.ap + 1);
  assert.equal(mp.result.stats.mp, base.result.stats.mp + 1);
  assert.equal(ap.result.syntheticApBudget, base.result.syntheticApBudget + 1);
  assert.ok(score(ap) > score(base));
});

test('MP exo satisfies a hard MP minimum without becoming offensive damage', () => {
  const items = completeItems({ stats: { ap: 5, mp: 2, earth: 100 } });
  const unconstrained = evaluate({ items });
  const rejected = evaluate({ items, constraints: { mp: 6 } });
  const rescued = evaluate({ items, constraints: { mp: 6 }, fmPolicy: { exoMp: 1 } });
  assert.equal(rejected.result, null);
  assert.equal(rejected.reason, 'constraint');
  assert.ok(rescued.result);
  assert.equal(rescued.result.stats.mp, 6);
  assert.equal(score(rescued), score(unconstrained));
});

test('permanent AP and MP caps are enforced on the equipment-first path', () => {
  const apCapped = evaluate({ items: completeItems({ stats: { ap: 5, mp: 3 } }), fmPolicy: { exoAp: 1 } });
  assert.equal(apCapped.result, null);
  assert.equal(apCapped.reason, 'permanent-stat-cap');
  assert.equal(apCapped.legalityDiagnostics.permanentCapViolations[0].stat, 'ap');

  const mpCapped = evaluate({ items: completeItems({ stats: { ap: 5, mp: 3 } }), fmPolicy: { exoMp: 1 } });
  assert.equal(mpCapped.result, null);
  assert.equal(mpCapped.reason, 'permanent-stat-cap');
  assert.equal(mpCapped.legalityDiagnostics.permanentCapViolations[0].stat, 'mp');
});

test('hard initiative constraint rejects higher offense and keeps lower feasible build', () => {
  const highOffense = evaluate({
    items: completeItems({ stats: { ap: 5, mp: 3, power: 1000 }, idPrefix: 'high' }),
    constraints: { initiative: 100 }
  });
  const feasible = evaluate({
    items: completeItems({ stats: { ap: 5, mp: 3, earth: 100 }, idPrefix: 'legal' }),
    constraints: { initiative: 100 }
  });
  assert.equal(highOffense.result, null);
  assert.equal(highOffense.reason, 'constraint');
  assert.ok(feasible.result);
  assert.equal(feasible.result.constraintsSatisfied, true);
});

test('legacy offensive FM policy fields are parked on equipment-first evaluation', () => {
  const items = completeItems({ stats: { ap: 5, mp: 3, earth: 100 } });
  const baseline = evaluate({ items });
  const legacyPolicy = evaluate({ items, fmPolicy: { spellDamagePct: 999, allowCritDamage: true, critDamageAmount: 999 } });
  assert.equal(score(legacyPolicy), score(baseline));
  assert.equal(legacyPolicy.result.fm.legacyOffensiveFmApplied, false);
});

test('invalid complete slot structure is rejected explicitly', () => {
  const items = completeItems({ stats: { ap: 5, mp: 3 } }).slice(0, -1);
  const evaluation = evaluate({ items });
  assert.equal(evaluation.result, null);
  assert.equal(evaluation.reason, 'structural-invalid');
});

test('complete-build comparator is min-first, then mean, then sorted item identity', () => {
  const a = evaluate({
    items: completeItems({ stats: { ap: 5, mp: 3, fire: 300, water: 300 }, idPrefix: 'b' }),
    syntheticOffense: { elements: ['fire', 'water'], profiles: ['large'] }
  }).result;
  const b = evaluate({
    items: completeItems({ stats: { ap: 5, mp: 3, fire: 900 }, idPrefix: 'a' }),
    syntheticOffense: { elements: ['fire', 'water'], profiles: ['large'] }
  }).result;
  assert.ok(a.syntheticOffense.minimumScore > b.syntheticOffense.minimumScore);
  assert.ok(compareCompleteEquipmentBuildResults(a, b) > 0);

  const meanLow = evaluate({
    items: completeItems({ stats: { ap: 5, mp: 3, fire: 100 }, idPrefix: 'z' }),
    syntheticOffense: { elements: ['fire', 'water'], profiles: ['large'] }
  }).result;
  const meanHigh = evaluate({
    items: completeItems({ stats: { ap: 5, mp: 3, fire: 200 }, idPrefix: 'y' }),
    syntheticOffense: { elements: ['fire', 'water'], profiles: ['large'] }
  }).result;
  assert.equal(meanLow.syntheticOffense.minimumScore, meanHigh.syntheticOffense.minimumScore);
  assert.ok(meanHigh.syntheticOffense.meanScore > meanLow.syntheticOffense.meanScore);
  assert.ok(compareCompleteEquipmentBuildResults(meanHigh, meanLow) > 0);

  const identityA = evaluate({ items: completeItems({ stats: { ap: 5, mp: 3 }, idPrefix: 'a' }) }).result;
  const identityB = evaluate({ items: completeItems({ stats: { ap: 5, mp: 3 }, idPrefix: 'b' }) }).result;
  assert.equal(identityA.syntheticOffense.minimumScore, identityB.syntheticOffense.minimumScore);
  assert.equal(identityA.syntheticOffense.meanScore, identityB.syntheticOffense.meanScore);
  assert.equal(completeEquipmentBuildIdentity(identityA.items) < completeEquipmentBuildIdentity(identityB.items), true);
  assert.ok(compareCompleteEquipmentBuildResults(identityA, identityB) > 0);
});
