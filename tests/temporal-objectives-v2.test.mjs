import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { TURN_MODES } from '../js/config.js';
import { createOptimizerV2Request } from '../js/optimizer-v2-orchestrator.js';
import { evaluateObjective } from '../js/spells.js';
import {
  aggregateTemporalScore,
  constantTemporalScore,
  temporalObjectiveMetrics,
  turnsForTemporalMode
} from '../js/temporal-objectives.js';
import { optimizeCombatSequence } from '../js/turn-optimizer.js';
import { combatPlanIsComplete } from '../js/final-result-validator.js';
import { analyzeWorkshopTurns } from '../js/workshop/workshop-turn-analysis.js';

function damageSpell({ id = 'hit', apCost = 4, base = 100, maxCastPerTurn = 2 } = {}) {
  return {
    id,
    name: id,
    apCost,
    baseCritPct: 0,
    maxCastPerTurn,
    maxCastPerTarget: maxCastPerTurn,
    distanceOptions: ['melee', 'ranged'],
    hits: [{ element: 'air', normal: [base, base], crit: [base, base] }],
    combatModifiers: [],
    combatRelevant: true
  };
}

function supportSpell({ id = 'setup', apCost = 8, power = 200 } = {}) {
  return {
    id,
    name: id,
    apCost,
    baseCritPct: 0,
    maxCastPerTurn: 1,
    maxCastPerTarget: 1,
    hits: [],
    combatModifiers: [{ id: `${id}-power`, scope: 'self', stats: { power }, durationTurns: 3 }],
    combatRelevant: true,
    supportOnly: true
  };
}

test('les objectifs temporels finaux ont une sémantique mathématique canonique', () => {
  const perTurn = { 1: 120, 2: 180, 3: 300 };
  assert.deepEqual(turnsForTemporalMode('t1'), [1]);
  assert.deepEqual(turnsForTemporalMode('constant'), [1, 2, 3]);
  assert.equal(aggregateTemporalScore(perTurn, 't1'), 120);
  assert.equal(aggregateTemporalScore(perTurn, 't2'), 180);
  assert.equal(aggregateTemporalScore(perTurn, 't3'), 300);
  assert.equal(aggregateTemporalScore(perTurn, 'sum'), 600);
  assert.equal(aggregateTemporalScore(perTurn, 'average'), 200);
  assert.equal(aggregateTemporalScore(perTurn, 'min'), 120);
  assert.ok(Math.abs(aggregateTemporalScore(perTurn, 'constant') - 171.42857142857142) < 1e-9);
});

test('Constant est la moyenne harmonique et pénalise un tour nul', () => {
  assert.equal(constantTemporalScore([100, 100, 100]), 100);
  assert.equal(constantTemporalScore([200, 100, 100]), 120);
  assert.equal(constantTemporalScore([300, 300, 0]), 0);
  const balanced = temporalObjectiveMetrics({ 1: 200, 2: 200, 3: 200 });
  const bursty = temporalObjectiveMetrics({ 1: 0, 2: 300, 3: 300 });
  assert.equal(balanced.sum, bursty.sum);
  assert.ok(balanced.constant > bursty.constant);
});

test('le scoring rapide evaluateObjective utilise exactement la même définition Constant', () => {
  const spell = damageSpell({ apCost: 2, base: 100, maxCastPerTurn: 1 });
  const selection = { enabled: true, weight: 1, spell, casts: { 1: 1, 2: 1, 3: 1 } };
  const item = {
    id: 'temporal-item',
    passives: [],
    turnBonuses: { 2: { air: 100 }, 3: { air: 200 } }
  };
  const result = evaluateObjective({
    stats: { air: 0 },
    items: [item],
    selections: [selection],
    turnMode: 'constant'
  });
  assert.deepEqual(result.perTurn, { 1: 100, 2: 200, 3: 300 });
  assert.equal(result.score, constantTemporalScore([100, 200, 300]));
});

test('le moteur exact préfère la régularité en Constant quand le cumul préfère un setup burst', () => {
  const hit = damageSpell();
  const setup = supportSpell();
  const common = {
    baseStats: { ap: 8, air: 0 },
    spells: [hit, setup],
    beamWidth: 800,
    interTurnWidth: 48,
    maxActionsPerTurn: 8
  };

  const sum = optimizeCombatSequence({
    ...common,
    objective: { turnMode: 'sum', allowSupport: true }
  });
  const constant = optimizeCombatSequence({
    ...common,
    objective: { turnMode: 'constant', allowSupport: true }
  });

  assert.equal(sum.sequence[0]?.spellId, 'setup');
  assert.equal(sum.perTurn[1], 0);
  assert.ok(sum.totalDamage > 600);
  assert.equal(constant.sequence.some((entry) => entry.spellId === 'setup'), false);
  assert.deepEqual(constant.perTurn, { 1: 200, 2: 200, 3: 200 });
  assert.equal(constant.score, 200);
});

test('Constant traverse le contrat Optimiseur et exige un plan T1/T2/T3 complet', () => {
  const spell = damageSpell({ id: 'class-hit' });
  const spellData = {
    breeds: [{ id: 'class-a', name: 'Classe A', spellIds: [spell.id] }],
    spells: [{ ...spell, breedId: 'class-a' }]
  };
  const payload = createOptimizerV2Request({
    dataset: { items: [], sets: [] },
    spellData,
    classId: 'class-a',
    element: 'air',
    turnMode: 'constant'
  });
  assert.ok(TURN_MODES.some(([id]) => id === 'constant'));
  assert.equal(payload.turnMode, 'constant');
  assert.equal(payload.combatObjective.turnMode, 'constant');

  const plan = optimizeCombatSequence({
    baseStats: { ap: 8, air: 0 },
    spells: [spell],
    objective: { turnMode: 'constant' },
    beamWidth: 100
  });
  assert.equal(combatPlanIsComplete({ combatPlan: plan }, 'constant'), true);
  assert.deepEqual(plan.objective.activeTurns, [1, 2, 3]);
});

test('l’analyse Atelier calcule une seule rotation cohérente sur un build fixé', () => {
  const spell = damageSpell({ apCost: 4, base: 50, maxCastPerTurn: 1 });
  const evaluation = {
    valid: true,
    complete: true,
    stats: { ap: 4, air: 0 },
    effectiveStatsByTurn: {
      1: { ap: 4, air: 0 },
      2: { ap: 4, air: 0 },
      3: { ap: 4, air: 0 }
    },
    combatSpells: [spell]
  };
  const analysis = analyzeWorkshopTurns(evaluation);
  assert.deepEqual(analysis.turns.map(({ damage }) => damage), [50, 50, 50]);
  assert.deepEqual(analysis.turns.map(({ actions }) => actions.map((entry) => entry.spellId)), [['hit'], ['hit'], ['hit']]);
  assert.equal(analyzeWorkshopTurns(evaluation), analysis, 'le même rendu réutilise le calcul fixé');
});

test('l’UI Atelier affiche T1/T2/T3 et la rotation sans appeler la recherche équipement', async () => {
  const [statsSource, spellSource, analysisSource, html] = await Promise.all([
    readFile(new URL('../js/workshop/stats-panel.js', import.meta.url), 'utf8'),
    readFile(new URL('../js/workshop/spell-panel.js', import.meta.url), 'utf8'),
    readFile(new URL('../js/workshop/workshop-turn-analysis.js', import.meta.url), 'utf8'),
    readFile(new URL('../index.html', import.meta.url), 'utf8')
  ]);
  assert.match(statsSource, /Tours idéaux/);
  assert.match(spellSource, /Rotation exacte T1–T3/);
  assert.match(analysisSource, /optimizeCombatSequence/);
  assert.doesNotMatch(analysisSource, /candidate-search|architecture-search|optimizer-worker|CandidatePolicy|SetCoreCatalog/);
  assert.match(html, /Constant = moyenne harmonique/);
});
