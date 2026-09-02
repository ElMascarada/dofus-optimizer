import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { DEFAULT_FM } from '../js/config.js';
import { passiveDefinitionForItem } from '../js/dofus-passives.js';
import {
  MIN_CONDITION_KEYS,
  MIN_CONDITION_STATS,
  WORKSHOP_STAT_SECTIONS
} from '../js/stat-catalog.js';
import {
  addMinCondition,
  getActiveMinConditions,
  removeMinCondition,
  setActiveMinConditions
} from '../js/min-conditions.js';
import { normalizeOptimizerV2Constraints } from '../js/optimizer-v2-orchestrator.js';
import {
  dofusDamageEndpoint,
  evaluateObjective,
  evaluateTurnConstraints,
  spellDamageBreakdown,
  statsForTurn
} from '../js/spells.js';

const COLERE = Object.freeze({
  id: 'spell-13124',
  ankamaId: 13124,
  name: 'Colère de Iop',
  breedId: '8',
  apCost: 7,
  baseCritPct: 25,
  minRange: 1,
  maxRange: 1,
  distanceOptions: ['melee'],
  hits: [{ element: 'earth', normal: [81, 100], crit: [107, 130] }],
  damageSource: 'spell'
});

const CANONICAL_STATS = Object.freeze({
  earth: 1208,
  power: 340,
  crit: 44,
  critDamage: 135,
  damage: 1,
  damageEarth: 77,
  meleeDamagePct: 6,
  rangedDamagePct: 0,
  spellDamagePct: 0,
  finalDamagePct: 0
});

function passiveItem(ankamaId) {
  const definition = passiveDefinitionForItem({ ankamaId });
  assert.ok(definition, `passive ${ankamaId} must be known`);
  return { id: `item-${ankamaId}`, passives: [definition] };
}

const NEBULOUS = passiveItem(8698);
const PRYNYANG = passiveItem(22004);
const SIMPLE = Object.freeze({
  id: 'simple',
  baseCritPct: 0,
  distanceOptions: ['melee'],
  hits: [{ element: 'earth', normal: [100, 100], crit: [100, 100] }],
  damageSource: 'spell'
});

function damageFor(stats, spell = SIMPLE) {
  return spellDamageBreakdown(spell, stats, 1).normal[0];
}

test('A1 — formule Dofus: les arrondis intermédiaires sont appliqués couche par couche', () => {
  const result = dofusDamageEndpoint({
    baseDamage: 11,
    characteristic: 350,
    flatDamage: 25,
    sourcePct: 15,
    positionPct: 10,
    finalPct: 20
  });
  assert.deepEqual(result.stages, {
    scaled: 49,
    withFlat: 74,
    withCritical: 74,
    afterSource: 85,
    afterPosition: 93,
    final: 111
  });
  assert.equal(result.damage, 111);
});

test('A2 — Colère mêlée applique le % mêlée et jamais le % distance', () => {
  const baseline = spellDamageBreakdown(COLERE, { ...CANONICAL_STATS, meleeDamagePct: 0, rangedDamagePct: 0 });
  const melee = spellDamageBreakdown(COLERE, { ...CANONICAL_STATS, meleeDamagePct: 6, rangedDamagePct: 90 });
  const rangedOnly = spellDamageBreakdown(COLERE, { ...CANONICAL_STATS, meleeDamagePct: 0, rangedDamagePct: 90 });
  assert.ok(melee.normal[0] > baseline.normal[0]);
  assert.deepEqual(rangedOnly.normal, baseline.normal);
  assert.equal(melee.distance, 'melee');
});

test('A3 — Nébuleux T1 est appliqué exactement une fois', () => {
  const t1 = statsForTurn({}, [NEBULOUS], 1);
  assert.equal(t1.finalDamagePct, 20);
  assert.equal(damageFor(t1), 120);
});

test('A4 — Prynyang T1 est appliqué exactement une fois', () => {
  const t1 = statsForTurn({}, [PRYNYANG], 1);
  assert.equal(t1.finalDamagePct, 10);
  assert.equal(damageFor(t1), 110);
});

test('A5 — Nébuleux + Prynyang combinent leur bonus final T1 sans double application', () => {
  const t1 = statsForTurn({}, [NEBULOUS, PRYNYANG], 1);
  assert.equal(t1.finalDamagePct, 30);
  assert.equal(damageFor(t1), 130);
});

test('A6 — les dégâts statiques et T1 effectifs restent deux vérités distinctes', () => {
  const staticDamage = damageFor({});
  const effective = damageFor(statsForTurn({}, [NEBULOUS, PRYNYANG], 1));
  assert.equal(staticDamage, 100);
  assert.equal(effective, 130);
  assert.notEqual(staticDamage, effective);
});

test('A7 — cas canonique Colère: suppression du +27% FM caché explique la surévaluation', () => {
  assert.equal(DEFAULT_FM.spellDamagePct, 0, 'aucun % Do Sorts synthétique ne doit être injecté silencieusement');
  const staticBreakdown = spellDamageBreakdown(COLERE, CANONICAL_STATS);
  const t1Stats = statsForTurn(CANONICAL_STATS, [NEBULOUS, PRYNYANG], 1);
  const t1Breakdown = spellDamageBreakdown(COLERE, t1Stats);
  const hiddenFmBreakdown = spellDamageBreakdown(COLERE, { ...t1Stats, spellDamagePct: 27 });

  assert.deepEqual(staticBreakdown.normal, [1496, 1829]);
  assert.deepEqual(staticBreakdown.critical, [2094, 2496]);
  assert.equal(staticBreakdown.critChancePct, 69);
  assert.deepEqual(t1Breakdown.normal, [1944, 2377]);
  assert.ok(Math.abs(t1Breakdown.critical[0] - 2721) <= 1);
  assert.ok(Math.abs(t1Breakdown.critical[1] - 3243) <= 1);
  assert.deepEqual(hiddenFmBreakdown.normal, [2470, 3019]);
  assert.deepEqual(hiddenFmBreakdown.critical, [3456, 4119]);
});

test('B8 — le panneau de droite expose toutes les stats offensives importantes', () => {
  const offense = WORKSHOP_STAT_SECTIONS.find(({ id }) => id === 'offense');
  assert.ok(offense);
  const keys = new Set(offense.stats.map(({ key }) => key));
  for (const key of ['crit', 'critDamage', 'damage', 'damageNeutral', 'damageEarth', 'damageFire', 'damageWater', 'damageAir', 'spellDamagePct', 'weaponDamagePct', 'meleeDamagePct', 'rangedDamagePct', 'finalDamagePct']) {
    assert.ok(keys.has(key), `missing offense stat ${key}`);
  }
});

test('B9 — le panneau de droite expose les stats défensives et de mobilité importantes', () => {
  const defense = WORKSHOP_STAT_SECTIONS.find(({ id }) => id === 'defense');
  assert.ok(defense);
  const keys = new Set(defense.stats.map(({ key }) => key));
  for (const key of ['dodge', 'lock', 'apParry', 'mpParry', 'apReduction', 'mpReduction']) assert.ok(keys.has(key));
});

test('B10 — le panneau de droite expose les résistances importantes', () => {
  const res = WORKSHOP_STAT_SECTIONS.find(({ id }) => id === 'resistances');
  assert.ok(res);
  const keys = new Set(res.stats.map(({ key }) => key));
  for (const key of ['fixedResNeutral', 'fixedResEarth', 'fixedResFire', 'fixedResWater', 'fixedResAir', 'resNeutral', 'resEarth', 'resFire', 'resWater', 'resAir', 'critResistance', 'pushbackResistance', 'meleeResistancePct', 'rangedResistancePct', 'weaponResistancePct']) assert.ok(keys.has(key));
});

test('C11 — ajout générique Initiative ≥ X', () => {
  const conditions = addMinCondition([], { key: 'initiative', value: 1000 });
  assert.deepEqual(conditions, [{ key: 'initiative', value: 1000 }]);
});

test('C12 — ajout générique Do Crit ≥ X', () => {
  const conditions = addMinCondition([], { key: 'critDamage', value: 100 });
  assert.deepEqual(conditions, [{ key: 'critDamage', value: 100 }]);
});

test('C13 — plusieurs minima se cumulent dans le payload optimizer', () => {
  setActiveMinConditions([
    { key: 'initiative', value: 1000 },
    { key: 'critDamage', value: 100 }
  ]);
  const constraints = normalizeOptimizerV2Constraints({ ap: 12, mp: 6 });
  assert.equal(constraints.initiative, 1000);
  assert.equal(constraints.critDamage, 100);
  assert.equal(constraints.ap, 12);
  assert.equal(constraints.mp, 6);
  setActiveMinConditions([]);
});

test('C14 — une condition peut être supprimée sans toucher aux autres', () => {
  const conditions = removeMinCondition([
    { key: 'initiative', value: 1000 },
    { key: 'critDamage', value: 100 }
  ], 'initiative');
  assert.deepEqual(conditions, [{ key: 'critDamage', value: 100 }]);
});

test('C15 — un build sous le minimum générique est invalide', () => {
  const result = evaluateTurnConstraints({
    stats: { initiative: 999, critDamage: 100 },
    constraints: { initiative: 1000, critDamage: 100 },
    turnMode: 't1'
  });
  assert.equal(result.meets, false);
  assert.deepEqual(result.deficitsByTurn, { 1: { initiative: 1 } });
});

test('C16 — un build respectant tous les minima génériques reste valide', () => {
  const result = evaluateTurnConstraints({
    stats: { initiative: 1000, critDamage: 100 },
    constraints: { initiative: 1000, critDamage: 100 },
    turnMode: 't1'
  });
  assert.equal(result.meets, true);
  assert.deepEqual(result.deficitsByTurn, {});
});

test('C17 — l’objectif reste le maximum de dégâts parmi les builds faisables', () => {
  const selection = { enabled: true, weight: 1, spell: SIMPLE, casts: { 1: 1 } };
  const candidates = [
    { id: 'illegal-high-damage', stats: { earth: 300, initiative: 900 } },
    { id: 'valid-best', stats: { earth: 200, initiative: 1000 } },
    { id: 'valid-lower', stats: { earth: 100, initiative: 1200 } }
  ];
  const valid = candidates.filter(({ stats }) => evaluateTurnConstraints({ stats, constraints: { initiative: 1000 }, turnMode: 't1' }).meets);
  valid.sort((left, right) => evaluateObjective({ stats: right.stats, selections: [selection], turnMode: 't1' }).score
    - evaluateObjective({ stats: left.stats, selections: [selection], turnMode: 't1' }).score);
  assert.equal(valid[0].id, 'valid-best');
});

test('C18 — normalisation et résultat des minima sont déterministes', () => {
  const input = [
    { key: 'critDamage', value: 100 },
    { key: 'initiative', value: 1000 }
  ];
  const once = setActiveMinConditions(input);
  const first = normalizeOptimizerV2Constraints({ ap: 12, mp: 6 });
  const twice = setActiveMinConditions(input);
  const second = normalizeOptimizerV2Constraints({ ap: 12, mp: 6 });
  assert.deepEqual(once, twice);
  assert.deepEqual(first, second);
  setActiveMinConditions([]);
});

test('UI — statique/T1 et builder générique sont réellement branchés dans les surfaces produit', async () => {
  const [spellPanel, statsPanel, index, minUi] = await Promise.all([
    readFile(new URL('../js/workshop/spell-panel.js', import.meta.url), 'utf8'),
    readFile(new URL('../js/workshop/stats-panel.js', import.meta.url), 'utf8'),
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../js/min-conditions-ui.js', import.meta.url), 'utf8')
  ]);
  assert.match(spellPanel, /STATIQUE · Normal/);
  assert.match(spellPanel, /T1 EFFECTIF · Normal/);
  assert.match(spellPanel, /t1DamageSources/);
  assert.match(statsPanel, /WORKSHOP_STAT_SECTIONS/);
  assert.match(index, /min-conditions-ui\.js/);
  assert.match(minUi, /Ajouter condition/);
  assert.match(minUi, /Condition :/);
  assert.ok(MIN_CONDITION_KEYS.includes('initiative'));
  assert.ok(MIN_CONDITION_KEYS.includes('critDamage'));
  assert.ok(MIN_CONDITION_STATS.length > 20);
  assert.deepEqual(getActiveMinConditions(), []);
});
