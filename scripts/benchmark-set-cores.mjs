import { performance } from 'node:perf_hooks';
import { readFile } from 'node:fs/promises';

import { validateDofusSnapshot } from '../js/data-loader.js';
import { searchArchitecturesV2 } from '../js/architecture-search-v2.js';
import { buildSetCoreCatalog } from '../optimizer/set-core-catalog.js';

function spell(id, element, base = 55, critBase = base + 15) {
  return {
    id,
    name: id,
    apCost: 4,
    baseCritPct: 20,
    maxCastPerTurn: 3,
    maxCastPerTarget: 3,
    distanceOptions: ['melee', 'ranged'],
    hits: [{ element, normal: [base, base], crit: [critBase, critBase] }],
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
    casts: { 1: enabled.has(1) ? 1 : 0, 2: enabled.has(2) ? 1 : 0, 3: enabled.has(3) ? 1 : 0 }
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
    typeName: slot === 'dofus' ? 'Dofus' : slot,
    certified: true,
    ...extra
  };
}

function fillers(slot, count) {
  return Array.from({ length: count }, (_, index) => gear(`${slot}-${index}`, slot, {
    earth: 155 - index * 2,
    fire: 118 + (index % 5) * 4,
    power: 12 + (index % 4) * 4,
    crit: index % 4 === 0 ? 5 : 0,
    critDamage: index % 5 === 0 ? 12 : 0,
    damageEarth: index % 4,
    damageFire: (index + 1) % 4,
    vit: 120 + (index % 4) * 35,
    initiative: 100 + (index % 4) * 100,
    resEarth: index % 3
  }));
}

function fixture() {
  const items = ['hat', 'cape', 'amulet', 'belt', 'boots', 'weapon', 'shield', 'companion']
    .flatMap((slot) => fillers(slot, 8));
  items.push(...fillers('ring', 12), ...fillers('dofus', 18));
  items.push(
    gear('ap-cape', 'cape', { ap: 1, earth: 35, fire: 35, vit: 160 }),
    gear('ap-amulet', 'amulet', { ap: 1, earth: 40, fire: 40, vit: 160 }),
    gear('ap-weapon', 'weapon', { ap: 1, earth: 45, fire: 45, vit: 140 }),
    gear('mp-boots', 'boots', { mp: 1, earth: 45, fire: 45, vit: 170 }),
    gear('ocre', 'dofus', { ap: 1 }),
    gear('vulbis', 'dofus', { mp: 1 }),
    gear('init-hat', 'hat', { initiative: 1300, vit: 100 }),
    gear('init-ring', 'ring', { initiative: 1100, vit: 100 }),
    gear('init-belt', 'belt', { initiative: 1200, vit: 100 }),
    gear('init-pet', 'companion', { initiative: 2400, vit: 100 }),
    gear('vit-hat', 'hat', { vit: 760 }), gear('vit-ring', 'ring', { vit: 700 }),
    gear('vit-belt', 'belt', { vit: 740 }), gear('vit-pet', 'companion', { vit: 1200 }),
    gear('res-hat', 'hat', { resEarth: 14, vit: 120 }), gear('res-ring', 'ring', { resEarth: 12, vit: 120 }),
    gear('res-shield', 'shield', { resEarth: 18, vit: 120 }), gear('res-pet', 'companion', { resEarth: 20, vit: 120 })
  );

  items.push(
    gear('oak-hat', 'hat', { earth: 55, vit: 230 }, { setId: 'oak' }),
    gear('oak-cape', 'cape', { earth: 55, crit: 4, vit: 230 }, { setId: 'oak' }),
    gear('oak-belt', 'belt', { earth: 50, initiative: 350, vit: 240 }, { setId: 'oak' }),
    gear('oak-ring', 'ring', { earth: 50, critDamage: 8, vit: 210 }, { setId: 'oak' }),
    gear('prism-amulet', 'amulet', { earth: 35, fire: 35, power: 30, vit: 210 }, { setId: 'prism' }),
    gear('prism-boots', 'boots', { earth: 35, fire: 35, crit: 5, vit: 210 }, { setId: 'prism' }),
    gear('prism-weapon', 'weapon', { earth: 40, fire: 40, critDamage: 10, vit: 180 }, { setId: 'prism' })
  );

  const sets = [
    {
      id: 'oak', name: 'Oak', equipmentIds: ['oak-hat', 'oak-cape', 'oak-belt', 'oak-ring'],
      bonuses: { 2: { earth: 130, vit: 120 }, 3: { earth: 180, crit: 6, initiative: 450 }, 4: { earth: 240, critDamage: 16, ap: 1 } }
    },
    {
      id: 'prism', name: 'Prism', equipmentIds: ['prism-amulet', 'prism-boots', 'prism-weapon'],
      bonuses: { 2: { power: 90, fire: 60, earth: 60 }, 3: { power: 130, crit: 8, mp: 1 } }
    }
  ];
  return { items, sets };
}

const earth = spell('earth', 'earth');
const fire = spell('fire', 'fire', 48, 68);
const fmPolicy = { spellDamagePct: 0, allowCritDamage: false, structuralExos: false };
const base = { ap: 12, mp: 6 };
const scenarios = [
  { name: 'mono-element', selections: [selection(earth)], constraints: base, turnMode: 't1' },
  { name: 'multi', selections: [selection(earth), selection(fire)], constraints: base, turnMode: 't1' },
  { name: 'crit', selections: [selection(earth)], constraints: { ...base }, turnMode: 't1', scenario: { targetCrit: true } },
  { name: 'high-initiative', selections: [selection(earth)], constraints: { ...base, initiative: 5000 }, turnMode: 't1' },
  { name: 'high-vita-res', selections: [selection(earth)], constraints: { ...base, vit: 4500, resEarth: 40 }, turnMode: 't1' },
  { name: 'T1', selections: [selection(earth)], constraints: base, turnMode: 't1' },
  { name: 'T1-T3', selections: [selection(earth, [1, 2, 3])], constraints: base, turnMode: 'sum' }
];

function round(value) {
  return Math.round(Number(value || 0) * 1000) / 1000;
}

function run(entry, enabled, items, sets) {
  const started = performance.now();
  const output = searchArchitecturesV2({
    items,
    sets,
    selections: entry.selections,
    constraints: entry.constraints,
    fmPolicy,
    turnMode: entry.turnMode,
    scenario: { ...(entry.scenario || {}), enableSetCores: enabled },
    topN: 5,
    searchProfile: 'FAST'
  });
  const totalMs = performance.now() - started;
  const setCore = output.diagnostics?.prefilter?.setCores || {};
  return {
    enabled,
    coresGenerated: Number(setCore.generated || 0),
    coresRelevant: Number(setCore.relevant || 0),
    coresInjected: Number(setCore.injected || 0),
    branchesExplored: Number(output.diagnostics?.expandedStates || 0),
    evaluatedBuilds: Number(output.diagnostics?.evaluated || 0),
    totalMs: round(totalMs),
    bestScore: output.results?.[0] ? round(output.results[0].score) : null
  };
}

const { items, sets } = fixture();
const comparisons = scenarios.map((entry) => {
  const before = run(entry, false, items, sets);
  const after = run(entry, true, items, sets);
  return {
    name: entry.name,
    before,
    after,
    scoreDelta: before.bestScore == null || after.bestScore == null ? null : round(after.bestScore - before.bestScore),
    timeDeltaMs: round(after.totalMs - before.totalMs)
  };
});

const raw = JSON.parse(await readFile(new URL('../data/normalized/dofus-data.json', import.meta.url), 'utf8'));
const snapshot = validateDofusSnapshot(raw);
const realStarted = performance.now();
const realCatalog = buildSetCoreCatalog({ items: snapshot.items, sets: snapshot.sets });
const realCatalogMs = performance.now() - realStarted;

console.log('SET_CORE_BENCHMARK_BEGIN');
console.log(JSON.stringify({
  node: process.version,
  fixture: { items: items.length, sets: sets.length },
  realData: { ...realCatalog.diagnostics, catalogMs: round(realCatalogMs) },
  comparisons
}, null, 2));
console.log('SET_CORE_BENCHMARK_END');
