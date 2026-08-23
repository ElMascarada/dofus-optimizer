import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { optimizeBuild } from '../js/solver.js';
import { SAMPLE_SPELLS } from '../js/sample-data.js';

const data = JSON.parse(await readFile(new URL('../data/normalized/dofus-data.json', import.meta.url), 'utf8'));
const spell = SAMPLE_SPELLS[0];
const start = performance.now();
const budgetMs = 30_000;

const output = optimizeBuild({
  items: data.items,
  sets: data.sets,
  selections: [{ enabled: true, weight: 1, spell, casts: { 1: 1, 2: 1, 3: 1 } }],
  constraints: { ap: 12, mp: 6, resEarth: 40, resFire: 40, resWater: 40, resAir: 40 },
  fmPolicy: { spellDamagePct: 3, allowCritDamage: true, critDamageAmount: 8 },
  turnMode: 'sum',
  scenario: {
    turns: {
      1: { attackedSinceLastTurn: false, enemyAdjacent: false, hpPct: 100, pourpreStacks: 0, turquoiseStacks: 0 },
      2: { attackedSinceLastTurn: false, enemyAdjacent: false, hpPct: 100, pourpreStacks: 0, turquoiseStacks: 0 },
      3: { attackedSinceLastTurn: false, enemyAdjacent: false, hpPct: 100, pourpreStacks: 0, turquoiseStacks: 0 }
    }
  },
  topN: 1,
  shouldAbort: () => performance.now() - start > budgetMs
});

const elapsedMs = performance.now() - start;
console.log(JSON.stringify({
  elapsedMs: Math.round(elapsedMs),
  results: output.results.length,
  bestScore: output.results[0]?.score || null,
  diagnostics: output.diagnostics
}, null, 2));

if (output.diagnostics.aborted) throw new Error(`Real snapshot solver exceeded ${budgetMs} ms budget.`);
if (!output.results.length) throw new Error('Real snapshot solver produced no legal build for the smoke constraints.');
