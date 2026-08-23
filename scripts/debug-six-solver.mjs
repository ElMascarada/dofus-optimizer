import { optimizeBuild } from '../js/solver.js';

const spell = { id: 's', name: 'S', baseCritPct: 0, hits: [{ element: 'earth', normal: [10, 10] }] };
const selections = [{ enabled: true, weight: 1, spell, casts: { 1: 1, 2: 1, 3: 1 } }];
const fmPolicy = { spellDamagePct: 3, allowCritDamage: false, critDamageAmount: 8 };
const noPoints = { level: 200, characteristicPoints: 0, scrolled: {}, baseStats: {} };
const items = Array.from({ length: 320 }, (_, index) => ({
  id: `d-${index}`,
  slot: 'dofus',
  stats: { power: 320 - index }
}));
const output = optimizeBuild({
  items,
  sets: [],
  selections,
  constraints: {},
  fmPolicy,
  slotRules: [{ id: 'dofus', count: 6 }],
  character: noPoints,
  topN: 1
});
console.log(JSON.stringify({
  results: output.results.map((result) => ({
    score: result.score,
    ids: result.items.map((item) => item.id)
  })),
  diagnostics: output.diagnostics
}, null, 2));
