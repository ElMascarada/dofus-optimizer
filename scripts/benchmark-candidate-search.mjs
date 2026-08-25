import { performance } from 'node:perf_hooks';

import { prefilterItems } from '../js/candidate-prefilter.js';
import { searchArchitecturesV2 } from '../js/architecture-search-v2.js';

function spell(id, element, base = 55) {
  return {
    id,
    name: id,
    apCost: 4,
    baseCritPct: 20,
    maxCastPerTurn: 3,
    maxCastPerTarget: 3,
    distanceOptions: ['melee', 'ranged'],
    hits: [{ element, normal: [base, base], crit: [base + 12, base + 12] }],
    combatModifiers: [],
    combatRelevant: true
  };
}

function selection(value, turns = [1]) {
  const enabled = new Set(turns);
  return {
    spell: value,
    enabled: true,
    weight: 1,
    casts: {
      1: enabled.has(1) ? 1 : 0,
      2: enabled.has(2) ? 1 : 0,
      3: enabled.has(3) ? 1 : 0
    }
  };
}

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
    typeName: slot === 'companion' ? 'Familier' : slot === 'dofus' ? 'Trophée' : slot,
    certified: true,
    ...extra
  };
}

function offensiveFillers(slot, count) {
  return Array.from({ length: count }, (_, index) => gear(`${slot}-off-${index}`, slot, {
    air: 175 - index * 2,
    fire: 125 + (index % 7) * 3,
    power: 16 + (index % 5) * 3,
    crit: index % 6 === 0 ? 4 : 0,
    critDamage: index % 7 === 0 ? 10 : 0,
    damageAir: index % 4,
    damageFire: (index + 2) % 4,
    vit: 90 + (index % 5) * 20,
    initiative: 80 + (index % 4) * 40,
    resEarth: index % 4,
    range: index % 11 === 0 ? 1 : 0
  }));
}

function fixtureItems() {
  const onePickSlots = ['hat', 'cape', 'amulet', 'belt', 'boots', 'weapon', 'shield', 'companion'];
  const items = onePickSlots.flatMap((slot) => offensiveFillers(slot, 18));
  items.push(...offensiveFillers('ring', 28));
  items.push(...offensiveFillers('dofus', 42));

  // Permanent 12/6 skeleton from the 8/4 base.
  items.push(
    gear('struct-ap-cape', 'cape', { ap: 1, air: 35, fire: 35, vit: 140 }),
    gear('struct-ap-amulet', 'amulet', { ap: 1, air: 40, fire: 40, vit: 140 }),
    gear('struct-ap-weapon', 'weapon', { ap: 1, air: 45, fire: 45, vit: 120 }),
    gear('struct-mp-boots', 'boots', { mp: 1, air: 45, fire: 45, vit: 150 }),
    gear('ocre', 'dofus', { ap: 1 }, { typeName: 'Dofus' }),
    gear('vulbis', 'dofus', { mp: 1 }, { typeName: 'Dofus' })
  );

  // Specialists intentionally weak offensively. They model the class of items
  // that the Candidate Policy must never lose only because of DPS ranking.
  items.push(
    gear('init-hat', 'hat', { initiative: 1000, vit: 100 }),
    gear('init-ring-a', 'ring', { initiative: 800, vit: 100 }),
    gear('init-ring-b', 'ring', { initiative: 780, vit: 110 }),
    gear('init-belt', 'belt', { initiative: 850, vit: 100 }),
    gear('init-shield', 'shield', { initiative: 800, vit: 100 }),
    gear('init-pet', 'companion', { initiative: 2000, vit: 100 }),
    gear('init-dofus', 'dofus', { initiative: 1200 }),

    gear('vit-hat', 'hat', { vit: 620 }),
    gear('vit-ring-a', 'ring', { vit: 560 }),
    gear('vit-ring-b', 'ring', { vit: 540 }),
    gear('vit-belt', 'belt', { vit: 600 }),
    gear('vit-shield', 'shield', { vit: 560 }),
    gear('vit-pet', 'companion', { vit: 1000 }),
    gear('vit-dofus', 'dofus', { vit: 500 }),

    gear('res-hat', 'hat', { resEarth: 12, vit: 100 }),
    gear('res-ring-a', 'ring', { resEarth: 10, vit: 100 }),
    gear('res-ring-b', 'ring', { resEarth: 9, vit: 100 }),
    gear('res-belt', 'belt', { resEarth: 11, vit: 100 }),
    gear('res-shield', 'shield', { resEarth: 15, vit: 100 }),
    gear('res-pet', 'companion', { resEarth: 18, power: 10 }),
    gear('res-dofus', 'dofus', { resEarth: 12 }),

    gear('range-hat', 'hat', { range: 2, vit: 100 }),
    gear('range-ring-a', 'ring', { range: 2, vit: 100 }),
    gear('range-belt', 'belt', { range: 2, vit: 100 }),
    gear('range-shield', 'shield', { range: 2, vit: 100 }),
    gear('range-dofus', 'dofus', { range: 2 })
  );

  return items;
}

const fmPolicy = {
  spellDamagePct: 0,
  allowCritDamage: false,
  critDamageAmount: 8,
  structuralExos: false
};

const air = spell('air-benchmark', 'air');
const fire = spell('fire-benchmark', 'fire', 48);
const items = fixtureItems();

const baseConstraints = Object.freeze({ ap: 12, mp: 6 });
const scenarios = [
  { name: 'mono-element-simple', selections: [selection(air)], constraints: baseConstraints, turnMode: 't1' },
  { name: 'multi-element', selections: [selection(air), selection(fire)], constraints: baseConstraints, turnMode: 't1' },
  { name: 'initiative-5000', selections: [selection(air)], constraints: { ...baseConstraints, initiative: 5000 }, turnMode: 't1' },
  { name: 'high-vitality', selections: [selection(air)], constraints: { ...baseConstraints, vit: 5000 }, turnMode: 't1' },
  { name: 'resistance', selections: [selection(air)], constraints: { ...baseConstraints, resEarth: 40 }, turnMode: 't1' },
  { name: 't1', selections: [selection(air)], constraints: baseConstraints, turnMode: 't1' },
  { name: 't1-t3', selections: [selection(air, [1, 2, 3])], constraints: baseConstraints, turnMode: 'sum' }
];

function round(value) {
  return Math.round(Number(value || 0) * 1000) / 1000;
}

function runScenario(entry) {
  const prefilterStart = performance.now();
  const prefilter = prefilterItems({
    items,
    sets: [],
    selections: entry.selections,
    constraints: entry.constraints,
    turnMode: entry.turnMode,
    scenario: {}
  });
  const prefilterMs = performance.now() - prefilterStart;

  const searchStart = performance.now();
  const output = searchArchitecturesV2({
    items,
    sets: [],
    selections: entry.selections,
    constraints: entry.constraints,
    fmPolicy,
    turnMode: entry.turnMode,
    scenario: {},
    topN: 5
  });
  const searchMs = performance.now() - searchStart;

  return {
    name: entry.name,
    initialItems: items.length,
    afterFilter: prefilter.items.length,
    exploredStates: Number(output.diagnostics?.expandedStates || 0),
    evaluatedBuilds: Number(output.diagnostics?.evaluated || 0),
    validBuilds: Number(output.diagnostics?.valid || 0),
    prefilterMs: round(prefilterMs),
    searchMs: round(searchMs),
    totalMs: round(prefilterMs + searchMs),
    bestScore: output.results?.length ? round(output.results[0].score) : null,
    bestInitiative: output.results?.[0]?.stats?.initiative ?? null,
    bestVitality: output.results?.[0]?.stats?.vit ?? null,
    bestEarthResistance: output.results?.[0]?.stats?.resEarth ?? null
  };
}

const results = scenarios.map(runScenario);
console.log('CANDIDATE_SEARCH_BENCHMARK_BEGIN');
console.log(JSON.stringify({
  node: process.version,
  fixture: 'candidate-policy-v1',
  initialItems: items.length,
  results
}, null, 2));
console.log('CANDIDATE_SEARCH_BENCHMARK_END');
