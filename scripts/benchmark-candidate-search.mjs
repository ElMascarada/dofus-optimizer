import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

import { prefilterItems } from '../js/candidate-prefilter.js';
import { searchArchitecturesV2 } from '../js/architecture-search-v2.js';
import { buildSetCoreCatalog } from '../optimizer/set-core-catalog.js';

function spell(id, element, base = 55, crit = 20) {
  return {
    id,
    name: id,
    apCost: 4,
    baseCritPct: crit,
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

  // Deliberately non-obvious set: the pieces are only average in isolation,
  // but their exact 2/3/4-piece payoffs can make a core worth exploring.
  items.push(
    gear('bench-core-hat', 'hat', { air: 95, fire: 95, crit: 2, vit: 150 }, { setId: 'benchmark-core' }),
    gear('bench-core-cape', 'cape', { air: 90, fire: 100, critDamage: 8, vit: 150 }, { setId: 'benchmark-core' }),
    gear('bench-core-belt', 'belt', { air: 100, fire: 90, initiative: 450, vit: 140 }, { setId: 'benchmark-core' }),
    gear('bench-core-boots', 'boots', { air: 95, fire: 95, resEarth: 8, vit: 170 }, { setId: 'benchmark-core' })
  );

  return items;
}

const sets = [{
  id: 'benchmark-core',
  name: 'Benchmark Core',
  bonuses: {
    '2': { air: 80, fire: 80, crit: 4 },
    '3': { air: 125, fire: 125, crit: 6, initiative: 250 },
    '4': { air: 170, fire: 170, crit: 8, resEarth: 6 }
  }
}];

const fmPolicy = {
  spellDamagePct: 0,
  allowCritDamage: false,
  critDamageAmount: 8,
  structuralExos: false
};

const air = spell('air-benchmark', 'air');
const fire = spell('fire-benchmark', 'fire', 48);
const critAir = spell('crit-air-benchmark', 'air', 52, 50);
const items = fixtureItems();

const baseConstraints = Object.freeze({ ap: 12, mp: 6 });
const scenarios = [
  { name: 'mono-element', selections: [selection(air)], constraints: baseConstraints, turnMode: 't1' },
  { name: 'multi', selections: [selection(air), selection(fire)], constraints: baseConstraints, turnMode: 't1' },
  { name: 'crit', selections: [selection(critAir)], constraints: baseConstraints, turnMode: 't1' },
  { name: 'initiative-5000', selections: [selection(air)], constraints: { ...baseConstraints, initiative: 5000 }, turnMode: 't1' },
  { name: 'high-vitality', selections: [selection(air)], constraints: { ...baseConstraints, vit: 5000 }, turnMode: 't1' },
  { name: 'resistance', selections: [selection(air)], constraints: { ...baseConstraints, resEarth: 40 }, turnMode: 't1' },
  { name: 't1', selections: [selection(air)], constraints: baseConstraints, turnMode: 't1' },
  { name: 't1-t3', selections: [selection(air, [1, 2, 3])], constraints: baseConstraints, turnMode: 'sum' }
];

function round(value) {
  return Math.round(Number(value || 0) * 1000) / 1000;
}

function injectedCandidateCount(prefilter) {
  const ids = new Set();
  for (const slot of prefilter?.diagnostics?.slots || []) {
    for (const [id, reasons] of Object.entries(slot.reasons || {})) {
      if ((reasons || []).includes('set-core')) ids.add(String(id));
    }
  }
  return ids.size;
}

function execute(entry, activeSets) {
  const prefilterStart = performance.now();
  const prefilter = prefilterItems({
    items,
    sets: activeSets,
    selections: entry.selections,
    constraints: entry.constraints,
    turnMode: entry.turnMode,
    scenario: {}
  });
  const prefilterMs = performance.now() - prefilterStart;

  const searchStart = performance.now();
  const output = searchArchitecturesV2({
    items,
    sets: activeSets,
    selections: entry.selections,
    constraints: entry.constraints,
    fmPolicy,
    turnMode: entry.turnMode,
    scenario: {},
    topN: 5
  });
  const searchMs = performance.now() - searchStart;

  return {
    afterFilter: prefilter.items.length,
    coresGenerated: Number(prefilter.diagnostics?.setCoreCatalog?.generated || 0),
    coresEliminated: Number(prefilter.diagnostics?.setCoreCatalog?.eliminated || 0),
    coresRelevant: Number(prefilter.diagnostics?.relevantCores || 0),
    coresInjected: Number(prefilter.diagnostics?.injectedCores || 0),
    candidatesInjected: injectedCandidateCount(prefilter),
    architectureVariants: Number(output.diagnostics?.architectureVariants || 0),
    exploredStates: Number(output.diagnostics?.expandedStates || 0),
    evaluatedBuilds: Number(output.diagnostics?.evaluated || 0),
    validBuilds: Number(output.diagnostics?.valid || 0),
    evaluatedByOrigin: output.diagnostics?.evaluatedByOrigin || {},
    prefilterMs: round(prefilterMs),
    searchMs: round(searchMs),
    totalMs: round(prefilterMs + searchMs),
    bestScore: output.results?.length ? round(output.results[0].score) : null,
    bestOrigin: output.results?.[0]?.searchOrigin || null,
    bestInitiative: output.results?.[0]?.stats?.initiative ?? null,
    bestVitality: output.results?.[0]?.stats?.vit ?? null,
    bestEarthResistance: output.results?.[0]?.stats?.resEarth ?? null
  };
}

function runScenario(entry) {
  const before = execute(entry, []);
  const after = execute(entry, sets);
  if (before.bestScore !== null && (after.bestScore === null || after.bestScore + 1e-6 < before.bestScore)) {
    throw new Error(`${entry.name}: hybrid set-core search regressed best score (${before.bestScore} -> ${after.bestScore})`);
  }
  return {
    name: entry.name,
    initialItems: items.length,
    before,
    after,
    delta: {
      exploredStates: after.exploredStates - before.exploredStates,
      totalMs: round(after.totalMs - before.totalMs),
      bestScore: before.bestScore === null || after.bestScore === null ? null : round(after.bestScore - before.bestScore)
    }
  };
}

function realCatalogReport() {
  const data = JSON.parse(readFileSync(new URL('../data/normalized/dofus-data.json', import.meta.url), 'utf8'));
  const started = performance.now();
  const catalog = buildSetCoreCatalog({ items: data.items || [], sets: data.sets || [] });
  const generationMs = performance.now() - started;
  const wanted = ['terre', 'crit', 'vita', 'res', 'PA'];
  const examples = [];
  for (const tag of wanted) {
    const core = catalog.cores.find((entry) => entry.tags.includes(tag) && !examples.some((example) => example.id === entry.id));
    if (!core) continue;
    examples.push({
      id: core.id,
      set: core.setName,
      pieceCount: core.pieceCount,
      items: core.items.map((item) => item.name),
      tags: core.tags.slice(0, 6),
      strengths: core.profile.strengths
    });
  }
  return {
    sets: Number((data.sets || []).length),
    items: Number((data.items || []).length),
    generationMs: round(generationMs),
    ...catalog.diagnostics,
    examples
  };
}

const results = scenarios.map(runScenario);
const realCatalog = realCatalogReport();
console.log('CANDIDATE_SEARCH_BENCHMARK_BEGIN');
console.log(JSON.stringify({
  node: process.version,
  fixture: 'candidate-policy-v2-set-cores',
  initialItems: items.length,
  realCatalog,
  results
}, null, 2));
console.log('CANDIDATE_SEARCH_BENCHMARK_END');
