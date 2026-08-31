import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { evaluateCompleteBuild } from '../js/complete-build-evaluator.js';
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

const historicalScreenshotNames = [
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

const historicalScreenshotItems = historicalScreenshotNames.map(itemByName);

function evaluateHistoricalScreenshotBuild() {
  return evaluateCompleteBuild({
    items: historicalScreenshotItems,
    sets: request.sets || [],
    selections: gearSelections,
    constraints: request.constraints,
    fmPolicy: { ...request.fmPolicy, structuralExos: false },
    turnMode: 't1',
    scenario: {
      ...(request.scenario || {}),
      requiredApByTurn: {},
      ignoredPassiveIds: [
        'deep-purple',
        'turquoise-blue',
        'vermilion-red',
        'yellow-ochre',
        'descent-to-abyss'
      ]
    }
  });
}

test('historical 13 permanent AP screenshot build is rejected by the permanent stat cap', () => {
  const evaluation = evaluateHistoricalScreenshotBuild();

  assert.equal(evaluation.result, null);
  assert.equal(evaluation.reason, 'permanent-stat-cap');
  assert.deepEqual(evaluation.legalityDiagnostics?.permanentCapViolations, [
    { stat: 'ap', actual: 13, maximum: 12 }
  ]);
});
