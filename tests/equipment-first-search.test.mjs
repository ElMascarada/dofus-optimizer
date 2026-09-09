import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SLOT_RULES } from '../js/config.js';
import {
  compareCompleteEquipmentBuildResults,
  evaluateCompleteEquipmentBuild
} from '../js/complete-equipment-build-evaluator.js';
import { searchEquipmentArchitecturesV2 } from '../js/equipment-search-v2.js';
import {
  createEquipmentCandidatePolicy,
  syntheticRelevantStatKeys
} from '../optimizer/equipment-candidate-policy.js';
import { getSearchProfile } from '../optimizer/search-profiles.js';

function item(id, slot, stats = {}, extra = {}) {
  return { id, name: id, slot, level: 200, stats: { ...stats }, conditions: null, setId: null, ...extra };
}

function fixedCatalog({ ap = 4, mp = 3 } = {}) {
  const output = [];
  for (const rule of SLOT_RULES) {
    for (let index = 0; index < rule.count; index++) {
      const stats = rule.id === 'amulet' && index === 0 ? { ap, mp } : {};
      output.push(item(`fixed-${rule.id}-${index}`, rule.id, stats));
    }
  }
  return output;
}

function withSlotVariants(base, slot, variants) {
  const kept = base.filter((entry) => entry.slot !== slot);
  const required = SLOT_RULES.find((rule) => rule.id === slot)?.count || 1;
  if (required === 1) return [...kept, ...variants];
  throw new Error(`withSlotVariants only supports single-count slots, got ${slot}`);
}

function combinations(values, count, start = 0, chosen = [], output = []) {
  if (chosen.length === count) {
    output.push([...chosen]);
    return output;
  }
  for (let index = start; index <= values.length - (count - chosen.length); index++) {
    chosen.push(values[index]);
    combinations(values, count, index + 1, chosen, output);
    chosen.pop();
  }
  return output;
}

function exhaustiveBuilds(items) {
  const bySlot = new Map();
  for (const entry of items) {
    if (!bySlot.has(entry.slot)) bySlot.set(entry.slot, []);
    bySlot.get(entry.slot).push(entry);
  }
  const groupChoices = SLOT_RULES.map((rule) => combinations(bySlot.get(rule.id) || [], rule.count));
  const output = [];
  function visit(index, selected) {
    if (index === groupChoices.length) {
      output.push([...selected]);
      return;
    }
    for (const choice of groupChoices[index]) visit(index + 1, [...selected, ...choice]);
  }
  visit(0, []);
  return output;
}

function sumItemStats(items = []) {
  const stats = {};
  for (const entry of items) {
    for (const [key, value] of Object.entries(entry?.stats || {})) {
      stats[key] = Number(stats[key] || 0) + Number(value || 0);
    }
  }
  return stats;
}

function exhaustiveOracle({ items, sets = [], constraints = {}, fmPolicy = {}, syntheticOffense, topN = 3 }) {
  const valid = [];
  for (const build of exhaustiveBuilds(items)) {
    const evaluation = evaluateCompleteEquipmentBuild({
      items: build,
      sets,
      constraints,
      fmPolicy,
      syntheticOffense
    });
    if (evaluation.result) valid.push(evaluation.result);
  }
  valid.sort((a, b) => -compareCompleteEquipmentBuildResults(a, b));
  return valid.slice(0, topN);
}

function runCase({ items, sets = [], constraints = {}, fmPolicy = {}, syntheticOffense, topN = 3 }) {
  const oracle = exhaustiveOracle({ items, sets, constraints, fmPolicy, syntheticOffense, topN });
  const search = searchEquipmentArchitecturesV2({
    items,
    sets,
    constraints,
    fmPolicy,
    syntheticOffense,
    topN
  });
  assert.ok(oracle.length > 0, 'oracle fixture must be feasible');
  assert.ok(search.results.length > 0, 'search must not be empty when oracle is feasible');
  assert.equal(search.results[0].buildIdentity, oracle[0].buildIdentity);
  assert.equal(search.results[0].syntheticOffense.minimumScore, oracle[0].syntheticOffense.minimumScore);
  assert.equal(search.results[0].syntheticOffense.meanScore, oracle[0].syntheticOffense.meanScore);
  return { oracle, search };
}

test('equipment-first entrypoint and policy have no real-spell/class/turn dependency', async () => {
  const sources = await Promise.all([
    readFile(new URL('../js/equipment-search-v2.js', import.meta.url), 'utf8'),
    readFile(new URL('../optimizer/equipment-candidate-policy.js', import.meta.url), 'utf8')
  ]);
  const joined = sources.join('\n');
  for (const forbidden of [
    'spells.js', 'source-certification', 'combat-planner', 'turn-optimizer',
    'evaluateCompleteBuild(', 'selections =', 'turnMode', 'classId', 'className', 'breedId'
  ]) {
    assert.equal(joined.includes(forbidden), false, `forbidden dependency/token: ${forbidden}`);
  }
  for (const legacy of [
    'spellDamagePct', 'meleeDamagePct', 'rangedDamagePct', 'weaponDamagePct',
    'finalDamagePctT1', 'finalDamagePctT2', 'finalDamagePctT3'
  ]) {
    assert.equal(joined.includes(legacy), false, `legacy offense key leaked into new path: ${legacy}`);
  }
});

test('candidate policy derives synthetic dimensions from request, including MULTI and Initiative', () => {
  const earth = syntheticRelevantStatKeys({ elements: ['earth'], profiles: ['large'] });
  for (const key of ['earth', 'damageEarth', 'power', 'damage', 'crit', 'critDamage', 'ap']) assert.ok(earth.includes(key));
  assert.equal(earth.includes('damageFire'), false);

  const multi = syntheticRelevantStatKeys({ elements: ['multi'], profiles: ['small'] });
  for (const key of ['earth', 'fire', 'water', 'air', 'damageEarth', 'damageFire', 'damageWater', 'damageAir']) assert.ok(multi.includes(key));

  const policy = createEquipmentCandidatePolicy({
    items: fixedCatalog(),
    constraints: { initiative: 1000 },
    syntheticOffense: { elements: ['earth'], profiles: ['large'] }
  });
  for (const key of ['earth', 'fire', 'water', 'air', 'initiative']) assert.ok(policy.paretoKeys.includes(key));
});

test('reduced exhaustive oracle A-E: mono, balance, multi, crit-large, small-flat', () => {
  const base = fixedCatalog();
  const cases = [
    {
      name: 'MONO',
      syntheticOffense: { elements: ['earth'], profiles: ['large'] },
      items: withSlotVariants(base, 'hat', [item('mono-earth', 'hat', { earth: 220 }), item('mono-power', 'hat', { power: 180 })])
    },
    {
      name: 'TWO_ELEMENT_BALANCE',
      syntheticOffense: { elements: ['fire', 'water'], profiles: ['small', 'large'] },
      items: withSlotVariants(base, 'hat', [
        item('fire-specialist', 'hat', { fire: 500, damageFire: 20 }),
        item('water-specialist', 'hat', { water: 500, damageWater: 20 }),
        item('balanced', 'hat', { fire: 260, water: 260, damage: 10 })
      ])
    },
    {
      name: 'MULTI',
      syntheticOffense: { elements: ['multi'], profiles: ['small'] },
      items: withSlotVariants(base, 'hat', [
        item('multi-flat', 'hat', { damage: 50 }),
        item('multi-power', 'hat', { power: 120 }),
        item('multi-mono', 'hat', { earth: 500 })
      ])
    },
    {
      name: 'CRIT_LARGE',
      syntheticOffense: { elements: ['earth'], profiles: ['large'] },
      items: withSlotVariants(base, 'hat', [
        item('raw-characteristic', 'hat', { earth: 200 }),
        item('crit-specialist', 'hat', { crit: 50, critDamage: 150 })
      ])
    },
    {
      name: 'SMALL_FLAT',
      syntheticOffense: { elements: ['earth'], profiles: ['small'] },
      items: withSlotVariants(base, 'hat', [
        item('small-characteristic', 'hat', { earth: 200 }),
        item('small-flat', 'hat', { damageEarth: 50 })
      ])
    }
  ];
  for (const fixture of cases) {
    const { search } = runCase(fixture);
    assert.equal(search.diagnostics.syntheticBoundUsed, false, fixture.name);
  }
});

test('oracle F: surplus AP remains offensive beyond AP >= 11', () => {
  const base = fixedCatalog({ ap: 4, mp: 3 });
  const { oracle, search } = runCase({
    items: withSlotVariants(base, 'hat', [
      item('strong-11ap', 'hat', { earth: 60 }),
      item('slightly-weaker-12ap', 'hat', { ap: 1, earth: 50 })
    ]),
    constraints: { ap: 11 },
    syntheticOffense: { elements: ['earth'], profiles: ['large'] },
    topN: 2
  });
  assert.equal(oracle[0].items.some((entry) => entry.id === 'slightly-weaker-12ap'), true);
  assert.equal(search.results[0].syntheticApBudget, 12);
});

test('oracle G: hard Initiative keeps the legal lower-offense lineage', () => {
  const base = fixedCatalog();
  const { oracle } = runCase({
    items: withSlotVariants(base, 'hat', [
      item('offense-only', 'hat', { power: 450 }),
      item('initiative-lineage', 'hat', { earth: 80, initiative: 1200 })
    ]),
    constraints: { initiative: 1400 },
    syntheticOffense: { elements: ['earth'], profiles: ['large'] }
  });
  assert.equal(oracle[0].items.some((entry) => entry.id === 'initiative-lineage'), true);
});

test('oracle H: weak individual set pieces remain discoverable when set bonus wins', () => {
  let base = fixedCatalog();
  base = withSlotVariants(base, 'hat', [
    item('standalone-hat', 'hat', { earth: 180 }),
    item('set-hat', 'hat', { earth: 20 }, { setId: 'set-win' })
  ]);
  base = withSlotVariants(base, 'cape', [
    item('standalone-cape', 'cape', { earth: 180 }),
    item('set-cape', 'cape', { earth: 20 }, { setId: 'set-win' })
  ]);
  const sets = [{ id: 'set-win', name: 'Set Win', bonuses: { '2': { power: 500, damageEarth: 30 } } }];
  const { oracle } = runCase({
    items: base,
    sets,
    syntheticOffense: { elements: ['earth'], profiles: ['large'] }
  });
  assert.equal(oracle[0].items.some((entry) => entry.id === 'set-hat'), true);
  assert.equal(oracle[0].items.some((entry) => entry.id === 'set-cape'), true);
});

test('oracle I: structural exo AP affects offense and exo MP rescues feasibility without scoring directly', () => {
  const apBase = fixedCatalog({ ap: 4, mp: 3 });
  const noExo = exhaustiveOracle({
    items: apBase,
    syntheticOffense: { elements: ['earth'], profiles: ['large'] },
    topN: 1
  })[0];
  const { oracle: apOracle } = runCase({
    items: apBase,
    fmPolicy: { exoAp: 1 },
    syntheticOffense: { elements: ['earth'], profiles: ['large'] },
    topN: 1
  });
  assert.equal(apOracle[0].syntheticApBudget, noExo.syntheticApBudget + 1);
  assert.ok(apOracle[0].syntheticOffense.minimumScore > noExo.syntheticOffense.minimumScore);

  const mpBase = fixedCatalog({ ap: 4, mp: 2 });
  const rejected = exhaustiveOracle({
    items: mpBase,
    constraints: { mp: 6 },
    syntheticOffense: { elements: ['earth'], profiles: ['large'] },
    topN: 1
  });
  assert.equal(rejected.length, 0);
  const { oracle: mpOracle } = runCase({
    items: mpBase,
    constraints: { mp: 6 },
    fmPolicy: { exoMp: 1 },
    syntheticOffense: { elements: ['earth'], profiles: ['large'] },
    topN: 1
  });
  assert.equal(mpOracle[0].stats.mp, 6);
});

test('topN=3 exactly matches exhaustive oracle order and scans every generated complete state', () => {
  const base = fixedCatalog();
  const fixture = {
    items: withSlotVariants(base, 'hat', [
      item('top-a', 'hat', { earth: 160, damageEarth: 12 }),
      item('top-b', 'hat', { earth: 140, crit: 20, critDamage: 30 }),
      item('top-c', 'hat', { earth: 120, damageEarth: 20 }),
      item('top-d', 'hat', { earth: 80 })
    ]),
    syntheticOffense: { elements: ['earth'], profiles: ['small', 'large'] },
    topN: 3
  };
  const { oracle, search } = runCase(fixture);
  assert.deepEqual(search.results.map((result) => result.buildIdentity), oracle.map((result) => result.buildIdentity));
  assert.equal(search.diagnostics.authoritativeEvaluated, search.diagnostics.completeStates);
  assert.equal(search.diagnostics.evaluated, search.diagnostics.completeStates);
  assert.equal(search.diagnostics.finalEvaluationTrimmed, 0);
});

test('unique feasible late lineage survives many better partial-offense candidates', () => {
  const base = fixedCatalog();
  const hats = [];
  for (let index = 0; index < 260; index++) hats.push(item(`offense-${index}`, 'hat', { power: 300 + index }));
  hats.push(item('only-feasible', 'hat', { initiative: 1500 }));
  const items = withSlotVariants(base, 'hat', hats);
  const oracle = exhaustiveOracle({
    items,
    constraints: { initiative: 1500 },
    syntheticOffense: { elements: ['earth'], profiles: ['large'] },
    topN: 1
  });
  assert.ok(oracle.length > 0);
  const search = searchEquipmentArchitecturesV2({
    items,
    constraints: { initiative: 1500 },
    syntheticOffense: { elements: ['earth'], profiles: ['large'] },
    topN: 1
  });
  assert.ok(search.results.length > 0);
  assert.equal(search.results[0].buildIdentity, oracle[0].buildIdentity);
  assert.equal(search.results[0].items.some((entry) => entry.id === 'only-feasible'), true);
  assert.ok(search.diagnostics.trace.some((entry) => entry.stage === 'complete-evaluation-pool'));
});

test('late feasible complete build is evaluated beyond the historical final limit', () => {
  let items = fixedCatalog({ ap: 4, mp: 3 });
  const hats = [];
  const capes = [];
  for (let index = 0; index < 8; index++) {
    hats.push(item(`invalid-high-hat-${index}`, 'hat', { ap: 1, earth: 1000 + index }));
    capes.push(item(`invalid-high-cape-${index}`, 'cape', { ap: 1, earth: 1000 + index }));
  }
  for (let index = 0; index < 4; index++) {
    hats.push(item(`valid-late-hat-${index}`, 'hat', { earth: 10 + index }));
    capes.push(item(`valid-late-cape-${index}`, 'cape', { earth: 10 + index }));
  }
  items = withSlotVariants(items, 'hat', hats);
  items = withSlotVariants(items, 'cape', capes);
  const syntheticOffense = { elements: ['earth'], profiles: ['large'] };
  const historicalLimit = getSearchProfile('BALANCED').search.evaluationLimit;
  const policy = createEquipmentCandidatePolicy({ items, syntheticOffense });
  const ranked = exhaustiveBuilds(items)
    .map((build) => ({
      build,
      rankScore: policy.rankStats(sumItemStats(build)).rankScore,
      key: build.map((entry) => String(entry.id)).sort().join('|')
    }))
    .sort((a, b) => b.rankScore - a.rankScore || a.key.localeCompare(b.key));

  assert.ok(ranked.length > historicalLimit);
  const historicalPrefix = ranked.slice(0, historicalLimit);
  assert.equal(historicalPrefix.length, historicalLimit);
  assert.equal(historicalPrefix.every(({ build }) => !evaluateCompleteEquipmentBuild({
    items: build,
    syntheticOffense
  }).result), true);

  const search = searchEquipmentArchitecturesV2({ items, syntheticOffense, topN: 1 });
  assert.ok(search.diagnostics.completeStates > historicalLimit);
  assert.equal(search.diagnostics.authoritativeEvaluated, search.diagnostics.completeStates);
  assert.equal(search.diagnostics.finalEvaluationTrimmed, 0);
  assert.ok(search.diagnostics.valid > 0);
  assert.ok(search.results.length > 0);
});

test('later authoritative winner beats an earlier valid heuristic favorite', () => {
  const heuristicFavorite = item('heuristic-favorite', 'hat', { earth: 500 }, {
    conditions: { kind: 'condition', stat: 'fire', operator: 'gte', value: 400 }
  });
  const authoritativeWinner = item('authoritative-winner', 'hat', { earth: 350 });
  const base = fixedCatalog();
  const items = withSlotVariants(base, 'hat', [heuristicFavorite, authoritativeWinner]);
  const syntheticOffense = { elements: ['earth'], profiles: ['large'] };
  const policy = createEquipmentCandidatePolicy({ items, syntheticOffense });
  assert.ok(policy.profileItem(heuristicFavorite).rankScore > policy.profileItem(authoritativeWinner).rankScore);

  const builds = exhaustiveBuilds(items);
  const favoriteBuild = builds.find((build) => build.some((entry) => entry.id === heuristicFavorite.id));
  const winnerBuild = builds.find((build) => build.some((entry) => entry.id === authoritativeWinner.id));
  const favoriteEvaluation = evaluateCompleteEquipmentBuild({ items: favoriteBuild, syntheticOffense });
  const winnerEvaluation = evaluateCompleteEquipmentBuild({ items: winnerBuild, syntheticOffense });
  assert.ok(favoriteEvaluation.result);
  assert.ok(winnerEvaluation.result);
  assert.ok(compareCompleteEquipmentBuildResults(winnerEvaluation.result, favoriteEvaluation.result) > 0);

  const search = searchEquipmentArchitecturesV2({ items, syntheticOffense, topN: 1 });
  assert.equal(search.diagnostics.authoritativeEvaluated, search.diagnostics.completeStates);
  assert.equal(search.diagnostics.finalEvaluationTrimmed, 0);
  assert.equal(search.results[0].buildIdentity, winnerEvaluation.result.buildIdentity);
});

test('single-pick group exposes every candidate-pool item beyond the nominal group limit', () => {
  const base = fixedCatalog();
  const hats = Array.from({ length: 18 }, (_, index) => item(`single-pick-${String(index).padStart(2, '0')}`, 'hat', { earth: 500 - index }));
  const items = withSlotVariants(base, 'hat', hats);
  const requiredItemIds = base.filter((entry) => entry.slot !== 'hat').map((entry) => entry.id);
  const profile = getSearchProfile('BALANCED');
  const search = searchEquipmentArchitecturesV2({
    items,
    requiredItemIds,
    syntheticOffense: { elements: ['earth'], profiles: ['large'] },
    topN: 18,
    searchProfile: profile
  });
  const hatBeam = search.diagnostics.trace.find((entry) => entry.stage === 'beam:hat');
  const resultHatIds = new Set(search.results.flatMap((result) => result.items.filter((entry) => entry.slot === 'hat').map((entry) => entry.id)));

  assert.equal(profile.search.groupChoiceLimits.hat, 12);
  assert.equal(search.candidatePools.hat.length, 18);
  assert.equal(hatBeam?.before, 18);
  assert.equal(hatBeam?.count, 18);
  assert.equal(search.diagnostics.completeStates, 18);
  assert.equal(search.results.length, 18);
  assert.deepEqual([...resultHatIds].sort(), hats.map((entry) => entry.id).sort());
  console.log('SINGLE_PICK_INPUT_COUNT=18');
  console.log('SINGLE_PICK_OUTPUT_COUNT=18');
  console.log('NO_SINGLE_PICK_GROUP_TRIM=PASS');
});

test('single-pick bypass preserves rank-11 witness when specialist reservations would fill nominal capacity first', () => {
  let base = fixedCatalog();
  base = base.map((entry) => entry.slot === 'amulet'
    ? {
        ...entry,
        setId: 'witness-set',
        conditions: { kind: 'condition', stat: 'range', operator: 'gte', value: 1 }
      }
    : entry);

  const high = [
    item('high-ap-0', 'hat', { ap: 1 }),
    item('high-ap-1', 'hat', { ap: 1 }),
    item('high-crit-0', 'hat', { crit: 100 }),
    item('high-crit-1', 'hat', { crit: 99 }),
    item('high-damage-0', 'hat', { damage: 100 }),
    item('high-damage-1', 'hat', { damage: 99 }),
    item('high-damage-earth-0', 'hat', { damageEarth: 100 }),
    item('high-damage-earth-1', 'hat', { damageEarth: 99 }),
    item('high-earth-0', 'hat', { earth: 500 }),
    item('high-earth-1', 'hat', { earth: 499 })
  ];
  const witness = item('a-witness', 'hat', {}, { setId: 'witness-set' });
  const neutralSpecialists = Array.from({ length: 7 }, (_, index) => {
    const stat = `neutralSpecialist${index}`;
    return item(`z-neutral-${index}`, 'hat', { [stat]: 1 }, {
      conditions: { kind: 'condition', stat, operator: 'gte', value: 0 }
    });
  });
  const hats = [...high, witness, ...neutralSpecialists];
  const items = withSlotVariants(base, 'hat', hats);
  const sets = [{ id: 'witness-set', name: 'Witness Set', bonuses: { '2': { range: 1 } } }];
  const requiredItemIds = base.filter((entry) => entry.slot !== 'hat').map((entry) => entry.id);
  const syntheticOffense = { elements: ['earth'], profiles: ['large'] };
  const profile = getSearchProfile('BALANCED');
  const policy = createEquipmentCandidatePolicy({ items, sets, syntheticOffense, searchProfile: profile });
  const rankedHats = hats
    .map((entry) => policy.profileItem(entry))
    .sort((a, b) => b.rankScore - a.rankScore || String(a.item.id).localeCompare(String(b.item.id)));
  const witnessRawRank = rankedHats.findIndex((entry) => entry.item.id === witness.id) + 1;

  const specialistSeen = new Set();
  for (const statKey of policy.paretoKeys) {
    const specialists = rankedHats
      .filter((entry) => Number(entry.optimisticStats?.[statKey] || 0) > 0)
      .sort((a, b) => Number(b.optimisticStats?.[statKey] || 0) - Number(a.optimisticStats?.[statKey] || 0)
        || b.rankScore - a.rankScore
        || String(a.item.id).localeCompare(String(b.item.id)))
      .slice(0, Number(profile.search.groupSpecialistReservePerStat));
    for (const entry of specialists) {
      specialistSeen.add(String(entry.item.id));
      if (specialistSeen.size >= Number(profile.search.groupChoiceLimits.hat)) break;
    }
    if (specialistSeen.size >= Number(profile.search.groupChoiceLimits.hat)) break;
  }

  assert.equal(witnessRawRank, 11);
  assert.equal(specialistSeen.size, 12);
  assert.equal(specialistSeen.has(witness.id), false);

  const search = searchEquipmentArchitecturesV2({
    items,
    sets,
    requiredItemIds,
    syntheticOffense,
    topN: 1,
    searchProfile: profile
  });
  assert.equal(search.candidatePools.hat.length, 18);
  assert.equal(search.diagnostics.completeStates, 18);
  assert.equal(search.results.length, 1);
  assert.equal(search.results[0].items.some((entry) => entry.id === witness.id), true);
  console.log(`WITNESS_RAW_RANK=${witnessRawRank}`);
  console.log('WITNESS_GROUP_PRESENT=YES');
});

test('final group diversity preserves a low raw-rank specialist in a genuine two-pick group', () => {
  let base = fixedCatalog();
  base = base.map((entry) => entry.slot === 'amulet'
    ? {
        ...entry,
        conditions: { kind: 'condition', stat: 'range', operator: 'gte', value: 1 }
      }
    : entry);
  const rings = [];
  for (let index = 0; index < 19; index++) rings.push(item(`raw-favorite-ring-${String(index).padStart(2, '0')}`, 'ring', { earth: 500 - index }));
  const witness = item('range-specialist-ring', 'ring', { range: 1 });
  rings.push(witness);
  const items = [...base.filter((entry) => entry.slot !== 'ring'), ...rings];
  const requiredItemIds = base.filter((entry) => entry.slot !== 'ring').map((entry) => entry.id);
  const profile = getSearchProfile('BALANCED');
  const syntheticOffense = { elements: ['earth'], profiles: ['large'] };
  const policy = createEquipmentCandidatePolicy({ items, syntheticOffense, searchProfile: profile });
  const rankedPairs = combinations(rings, 2)
    .map((pair) => ({
      pair,
      rankScore: policy.rankStats(sumItemStats(pair)).rankScore,
      key: pair.map((entry) => String(entry.id)).sort().join('|')
    }))
    .sort((a, b) => b.rankScore - a.rankScore || a.key.localeCompare(b.key));
  const bestWitnessPair = rankedPairs.find((entry) => entry.pair.some((ring) => ring.id === witness.id));
  const witnessRawRank = rankedPairs.findIndex((entry) => entry.key === bestWitnessPair.key) + 1;
  const oracle = exhaustiveOracle({ items, syntheticOffense, topN: 1 });

  assert.equal(searchEquipmentArchitecturesV2 === undefined, false);
  assert.equal(rings.length, 20);
  assert.equal(rankedPairs.length, 190);
  assert.ok(witnessRawRank > Number(profile.search.groupChoiceLimits.ring));
  assert.equal(oracle.length, 1);
  assert.equal(oracle[0].items.some((entry) => entry.id === witness.id), true);

  const search = searchEquipmentArchitecturesV2({
    items,
    requiredItemIds,
    syntheticOffense,
    topN: 1,
    searchProfile: profile
  });
  const ringBeam = search.diagnostics.trace.find((entry) => entry.stage === 'beam:ring');
  assert.equal(search.candidatePools.ring.length, 20);
  assert.equal(ringBeam?.before, Number(profile.search.groupChoiceLimits.ring));
  assert.ok(search.results.length > 0, 'multi-pick diversity selection must retain the legal low-rank range lineage');
  assert.equal(search.results[0].buildIdentity, oracle[0].buildIdentity);
  assert.equal(search.results[0].items.some((entry) => entry.id === witness.id), true);
  console.log('MULTI_PICK_FINAL_DIVERSITY_REGRESSION=PASS');
});
