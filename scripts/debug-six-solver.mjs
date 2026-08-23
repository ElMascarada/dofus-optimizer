import { optimizeBuild } from '../js/solver.js';

const spell = { id: 's', name: 'S', baseCritPct: 0, hits: [{ element: 'earth', normal: [10, 10] }] };
const selections = [{ enabled: true, weight: 1, spell, casts: { 1: 1, 2: 1, 3: 1 } }];
const fmPolicy = { spellDamagePct: 3, allowCritDamage: false, critDamageAmount: 8 };
const noPoints = { level: 200, characteristicPoints: 0, scrolled: {}, baseStats: {} };

function summarize(label, output) {
  console.log(label, JSON.stringify({
    results: output.results.map((result) => ({ score: result.score, ids: result.items.map((item) => item.id) })),
    seed: output.diagnostics.seed,
    groups: output.diagnostics.groups,
    prunedScore: output.diagnostics.prunedScore,
    impossible: output.diagnostics.impossible
  }, null, 2));
}

const resistance = optimizeBuild({
  items: [
    { id: 'h1', name: 'Damage', slot: 'hat', stats: { earth: 100 } },
    { id: 'h2', name: 'Res', slot: 'hat', stats: { earth: 20, resEarth: 40 } }
  ],
  sets: [], selections, constraints: { resEarth: 40 }, fmPolicy,
  slotRules: [{ id: 'hat', count: 1 }], character: noPoints, topN: 5
});
summarize('AFTER_RESISTANCE', resistance);

const setBuild = optimizeBuild({
  items: [
    { id: 'h', slot: 'hat', setId: 'set-a', stats: { earth: 20 } },
    { id: 'c', slot: 'cape', setId: 'set-a', stats: { earth: 20 } }
  ],
  sets: [{ id: 'set-a', name: 'A', bonuses: { '2': { ap: 1 } } }],
  selections, constraints: { ap: 12 }, fmPolicy,
  slotRules: [{ id: 'hat', count: 1 }, { id: 'cape', count: 1 }],
  character: { ...noPoints, baseStats: { ap: 11 } }, topN: 1
});
summarize('AFTER_SET', setBuild);

const smallItems = Array.from({ length: 6 }, (_, index) => ({ id: `small-d-${index}`, slot: 'dofus', stats: { power: 100 - index } }));
const small = optimizeBuild({
  items: smallItems, sets: [], selections, constraints: {}, fmPolicy,
  slotRules: [{ id: 'dofus', count: 6 }], character: noPoints, topN: 1
});
summarize('AFTER_SMALL_SIX', small);

const items = Array.from({ length: 320 }, (_, index) => ({ id: `d-${index}`, slot: 'dofus', stats: { power: 320 - index } }));
const output = optimizeBuild({
  items, sets: [], selections, constraints: {}, fmPolicy,
  slotRules: [{ id: 'dofus', count: 6 }], character: noPoints, topN: 1
});
summarize('AFTER_HUGE_SIX', output);
