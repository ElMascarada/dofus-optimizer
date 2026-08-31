import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { evaluateCompleteBuild } from '../js/complete-build-evaluator.js';
import { refineCombatTurns } from '../js/combat-turn-refiner.js';
import { createOptimizerV2Request } from '../js/optimizer-v2-orchestrator.js';
import { validateDofusSnapshot, validateSpellSnapshot } from '../js/data-loader.js';

const rawItems = JSON.parse(readFileSync(new URL('../data/normalized/dofus-data.json', import.meta.url), 'utf8'));
const rawSpells = JSON.parse(readFileSync(new URL('../data/normalized/spell-data.json', import.meta.url), 'utf8'));
const dataset = validateDofusSnapshot(rawItems);
const spellData = validateSpellSnapshot(rawSpells);
const iop = (spellData.breeds || []).find((breed) => breed?.name === 'Iop');

assert.ok(iop, 'Iop absent des données canoniques');

const request = createOptimizerV2Request({
  dataset,
  spellData,
  classId: String(iop.id),
  element: 'fire',
  constraints: {
    ap: 12,
    mp: 6,
    range: 0,
    vit: 0,
    initiative: 0,
    resEarth: 0,
    resFire: 0,
    resWater: 0,
    resAir: 0
  },
  turnMode: 't1',
  topN: 10
});

const ignoredPassiveIds = [
  'deep-purple',
  'turquoise-blue',
  'vermilion-red',
  'yellow-ochre',
  'descent-to-abyss'
];

const scenario = {
  ...(request.scenario || {}),
  requiredApByTurn: {},
  ignoredPassiveIds
};

const combatSpells = (request.classSpells || []).filter((spell) => {
  const support = (Array.isArray(spell?.combatModifiers) && spell.combatModifiers.length > 0)
    || (Array.isArray(spell?.delayedCombatModifiers) && spell.delayedCombatModifiers.length > 0)
    || Boolean(spell?.selfCharge);
  return support || (spell?.hits || []).some((hit) => hit?.element === 'fire');
});

const gearSelections = combatSpells
  .filter((spell) => (spell?.hits || []).some((hit) => hit?.element === 'fire'))
  .map((spell) => ({
    spell: { ...spell },
    enabled: true,
    weight: 1,
    casts: { 1: 1, 2: 0, 3: 0 }
  }));

function itemByName(name) {
  const matches = (dataset.items || []).filter((item) => item?.name === name);
  assert.equal(matches.length, 1, `item canonique ambigu ou absent: ${name}`);
  return matches[0];
}

const screenshotNames = [
  'Heaume de Guerre',
  'Capille',
  'Harpendentif',
  'Ceste de Guerre',
  'Anneau de Padgref',
  'Corset de Misère',
  'Bottarpille',
  'Épée Diablotine',
  'Forteresse de Guerre',
  'Sakochère',
  'Astucieux majeur',
  'Prynyang',
  'Robuste majeur',
  'Dofus Pourpre',
  'Dolmanax',
  'Pugiliste'
];

const screenshotItems = screenshotNames.map(itemByName);
const robuste = itemByName('Robuste majeur');
const withoutRobuste = screenshotItems.filter((item) => item.id !== robuste.id);
const equippedIdsWithoutRobuste = new Set(withoutRobuste.map((item) => String(item.id)));

function evaluateGear(items) {
  return evaluateCompleteBuild({
    items,
    sets: request.sets || [],
    selections: gearSelections,
    constraints: request.constraints,
    fmPolicy: { ...request.fmPolicy, structuralExos: false },
    turnMode: 't1',
    scenario
  });
}

function canonicalT1Damage(build) {
  const refined = refineCombatTurns({
    results: [build],
    spells: combatSpells,
    combatObjective: { ...request.combatObjective, turnMode: 't1' },
    scenario,
    topN: 1,
    preservePrysmaradites: false,
    searchProfile: request.searchProfile
  });
  const result = refined.results?.[0];
  assert.ok(result, 'rotation T1 canonique absente');
  return Number(result.combatPlan?.perTurn?.[1] ?? result.perTurn?.[1] ?? 0);
}

function offensiveTrophy(item) {
  if (String(item?.typeName || '').toLowerCase() !== 'trophée') return false;
  const stats = item?.stats || {};
  return [
    'fire',
    'power',
    'damage',
    'damageFire',
    'crit',
    'critDamage',
    'spellDamagePct',
    'meleeDamagePct',
    'rangedDamagePct',
    'weaponDamagePct',
    'finalDamagePct'
  ].some((key) => Number(stats[key] || 0) > 0);
}

test('observed Iop/Fire/T1 build exposes the canonical Robuste counterfactual', () => {
  const baselineEvaluation = evaluateGear(screenshotItems);
  assert.ok(baselineEvaluation.result, `capture non reproductible: ${baselineEvaluation.reason}`);
  const baseline = baselineEvaluation.result;

  assert.equal(baseline.stats.ap, 13);
  assert.equal(baseline.stats.mp, 6);
  assert.equal(baseline.stats.fire, 1158);
  assert.equal(baseline.stats.power, 450);
  assert.equal(baseline.stats.crit, 27);
  assert.equal(baseline.stats.critDamage, 154);

  const robusteDamage = canonicalT1Damage(baseline);
  const candidates = [];

  for (const alternative of (dataset.items || []).filter(offensiveTrophy)) {
    if (alternative.id === robuste.id) continue;
    // A replacement cannot duplicate an item already occupying another Dofus/trophy slot.
    if (equippedIdsWithoutRobuste.has(String(alternative.id))) continue;
    const evaluation = evaluateGear([...withoutRobuste, alternative]);
    if (!evaluation.result) continue;
    candidates.push({
      id: alternative.id,
      name: alternative.name,
      damage: canonicalT1Damage(evaluation.result)
    });
  }

  candidates.sort((a, b) => b.damage - a.damage || a.name.localeCompare(b.name));
  const best = candidates[0] || null;
  assert.ok(best, 'aucune alternative offensive légale trouvée');

  const delta = best.damage - robusteDamage;
  console.log('T1_RECOVERY_COUNTERFACTUAL');
  console.log('SCREENSHOT_BUILD_REPRODUCED=YES');
  console.log(`ROBUSTE_DAMAGE=${robusteDamage}`);
  console.log(`BEST_LEGAL_ALTERNATIVE=${best.name}`);
  console.log(`BEST_ALTERNATIVE_DAMAGE=${best.damage}`);
  console.log(`DELTA=${delta}`);
  console.log(`ROBUSTE_DOMINATED=${delta > 1e-9 ? 'YES' : 'NO'}`);
  console.log(`ASTUCIEUX_MAJOR_COMPATIBLE=${equippedIdsWithoutRobuste.has(String(itemByName('Astucieux majeur').id)) ? 'NO' : 'YES'}`);
  console.log(`LEGAL_OFFENSIVE_ALTERNATIVES=${candidates.map((candidate) => `${candidate.name}:${candidate.damage}`).join('|')}`);
});
