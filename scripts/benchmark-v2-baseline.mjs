import { performance } from 'node:perf_hooks';

import { prefilterItems } from '../js/candidate-prefilter.js';
import { evaluateCompleteBuild } from '../js/complete-build-evaluator.js';
import { finalizePartialCombatResults } from '../js/partial-result-finalizer.js';
import { optimizeCombatSequence } from '../js/turn-optimizer.js';

function damageSpell({ id = 'hit', apCost = 4, base = 100, element = 'air' } = {}) {
  return {
    id,
    name: id,
    apCost,
    baseCritPct: 0,
    maxCastPerTurn: 3,
    maxCastPerTarget: 3,
    distanceOptions: ['melee', 'ranged'],
    hits: [{ element, normal: [base, base], crit: [base, base] }],
    combatModifiers: [],
    combatRelevant: true
  };
}

function supportSpell() {
  return {
    id: 'buff',
    name: 'buff',
    apCost: 2,
    baseCritPct: 0,
    maxCastPerTurn: 1,
    maxCastPerTarget: 1,
    hits: [],
    combatModifiers: [{ id: 'power-buff', scope: 'self', stats: { power: 200 }, durationTurns: 2 }],
    combatRelevant: true,
    supportOnly: true
  };
}

function selection(spell) {
  return { spell, enabled: true, weight: 1, casts: { 1: 1, 2: 1, 3: 1 } };
}

function item(id, stats = {}, extra = {}) {
  return { id, name: id, slot: 'hat', stats, certified: true, ...extra };
}

function elapsed(name, iterations, run) {
  const timings = [];
  let fingerprint = null;
  for (let index = 0; index < iterations; index++) {
    const start = performance.now();
    fingerprint = run();
    timings.push(performance.now() - start);
  }
  timings.sort((a, b) => a - b);
  const medianMs = timings[Math.floor(timings.length / 2)];
  return {
    name,
    iterations,
    medianMs: Math.round(medianMs * 1000) / 1000,
    minMs: Math.round(timings[0] * 1000) / 1000,
    maxMs: Math.round(timings.at(-1) * 1000) / 1000,
    fingerprint
  };
}

const hit = damageSpell({ base: 40 });
const buff = supportSpell();
const constraintItems = [
  ...Array.from({ length: 30 }, (_, index) => item(`offense-${index}`, { air: 300 - index, power: 100 })),
  item('initiative-specialist', { initiative: 1600, air: 1 }),
  item('vitality-specialist', { vit: 1200, air: 1 }),
  item('resistance-specialist', { resEarth: 25, air: 1 })
];
const character = {
  level: 200,
  characteristicPoints: 0,
  scrolled: { earth: 0, fire: 0, water: 0, air: 0 },
  baseStats: { ap: 11, mp: 5, vit: 1000 }
};
const fmPolicy = { spellDamagePct: 0, allowCritDamage: false, structuralExos: false };

const benchmarks = [
  elapsed('mono-turn', 5, () => {
    const result = optimizeCombatSequence({
      baseStats: { ap: 8, air: 100 },
      spells: [damageSpell({ base: 100 })],
      objective: { turnMode: 't1', allowSupport: true }
    });
    return Math.round(result.score);
  }),
  elapsed('t1-t3', 3, () => {
    const result = optimizeCombatSequence({
      baseStats: { ap: 10, air: 100 },
      spells: [hit, buff],
      objective: { turnMode: 'sum', allowSupport: true },
      beamWidth: 300,
      interTurnWidth: 12
    });
    return Math.round(result.score);
  }),
  elapsed('constraints-ap-mp', 5, () => {
    const result = evaluateCompleteBuild({
      items: [item('resource-hat', { ap: 1, mp: 1 })],
      selections: [selection(hit)],
      constraints: { ap: 12, mp: 6 },
      character,
      fmPolicy,
      turnMode: 't1'
    });
    return `${result.reason || 'ok'}:${result.result?.stats?.ap || 0}/${result.result?.stats?.mp || 0}`;
  }),
  ...[
    ['constraint-initiative', 'initiative', 1600],
    ['constraint-vitality', 'vit', 1200],
    ['constraint-resistance', 'resEarth', 25]
  ].map(([name, stat, minimum]) => elapsed(name, 5, () => {
    const result = prefilterItems({
      items: constraintItems,
      selections: [selection(hit)],
      constraints: { [stat]: minimum },
      slotLimits: { hat: 18 }
    });
    return result.items.some((candidate) => candidate.id === `${stat === 'vit' ? 'vitality' : stat === 'resEarth' ? 'resistance' : 'initiative'}-specialist`);
  })),
  elapsed('set-bonus', 5, () => {
    const result = evaluateCompleteBuild({
      items: [item('set-a', {}, { setId: 'set-a' }), item('set-b', {}, { slot: 'cape', setId: 'set-a' })],
      sets: [{ id: 'set-a', name: 'Set A', bonuses: { 2: { power: 100 } } }],
      selections: [selection(hit)],
      constraints: {},
      character: { ...character, baseStats: { ap: 8, mp: 6, vit: 1000 } },
      fmPolicy,
      turnMode: 't1'
    });
    return `${result.result?.activeSets?.[0]?.count || 0}:${Math.round(result.result?.score || 0)}`;
  }),
  elapsed('buff-state', 5, () => {
    const result = optimizeCombatSequence({
      baseStats: { ap: 12, air: 100 },
      spells: [hit, buff],
      objective: { turnMode: 't1', allowSupport: true }
    });
    return `${result.sequence[0]?.spellId || 'none'}:${Math.round(result.score)}`;
  }),
  elapsed('manual-stop-finalization', 3, () => {
    const baseStats = { ap: 8, mp: 6, air: 100, vit: 1000 };
    const result = finalizePartialCombatResults({
      results: [{
        items: [item('partial')],
        stats: baseStats,
        effectiveStatsByTurn: { 1: baseStats, 2: baseStats, 3: baseStats },
        score: 0
      }],
      classSpells: [hit],
      combatObjective: { element: 'air', turnMode: 't1', allowSupport: true },
      topN: 1,
      candidateLimit: 1
    });
    return `${result.results.length}:${result.diagnostics.stoppedEarly === true}`;
  })
];

console.log('OPTIMIZER_V2_BENCHMARK_BEGIN');
console.log(JSON.stringify({ node: process.version, benchmarks }, null, 2));
console.log('OPTIMIZER_V2_BENCHMARK_END');
