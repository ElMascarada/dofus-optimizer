import assert from 'node:assert/strict';
import test from 'node:test';

import { critModeAllows } from '../js/equipment-search-request.js';
import { orderDofusItems } from '../js/dofus-order.js';
import { renderOptimizerResult } from '../js/optimizer-result-view.js';
import { createWorkshopBuildFromOptimizerResult } from '../js/workshop/workshop-build.js';
import { dofusPackageMatchesCritMode } from '../optimizer/dofus-crit-policy.js';

function dofus(id, name, stats = {}) {
  return {
    id,
    name,
    slot: 'dofus',
    level: 200,
    typeName: 'Dofus',
    slotSubtype: null,
    setId: null,
    stats,
    passives: [],
    conditions: null
  };
}

const turquoise = dofus('turquoise', 'Dofus Turquoise', { crit: 20 });
const power = dofus('power', 'Power Trophy', { power: 80 });

function result(critMode) {
  return {
    items: [power, turquoise],
    stats: {
      ap: 12,
      mp: 6,
      earth: 1000,
      power: 80,
      crit: 20
    },
    fm: { enabled: false, assignments: [] },
    activeSets: [],
    syntheticOffense: {
      minimumScore: 1000,
      critMode
    },
    workspaceContext: {
      constraints: { ap: 12, mp: 6 },
      fmPolicy: { enabled: false, fmEnabled: false, exoAp: 0, exoMp: 0 },
      syntheticOffense: {
        elements: ['earth'],
        profiles: ['large'],
        critMode
      },
      referenceScore: 1000
    }
  };
}

test('explicit Crit requires Turquoise while Auto remains free and No Crit rejects it', () => {
  assert.equal(critModeAllows({ items: [power] }, 'crit'), false);
  assert.equal(critModeAllows({ items: [power, turquoise] }, 'crit'), true);
  assert.equal(critModeAllows({ items: [power, turquoise] }, 'no_crit'), false);
  assert.equal(critModeAllows({ items: [power] }, 'no_crit'), true);
  assert.equal(critModeAllows({ items: [power] }, 'auto'), true);
  assert.equal(critModeAllows({ items: [power, turquoise] }, 'auto'), true);

  assert.equal(dofusPackageMatchesCritMode([power], 'crit'), false);
  assert.equal(dofusPackageMatchesCritMode([power, turquoise], 'crit'), true);
  assert.equal(dofusPackageMatchesCritMode([power, turquoise], 'no_crit'), false);
});

test('Crit presentation pins Turquoise first while Auto keeps marginal importance free', () => {
  assert.equal(orderDofusItems([power, turquoise], result('crit'))[0].name, 'Dofus Turquoise');
  assert.equal(orderDofusItems([power, turquoise], result('auto'))[0].name, 'Power Trophy');
});

test('optimizer result renders Turquoise leftmost in explicit Crit mode', () => {
  const html = renderOptimizerResult(result('crit'), 0);
  assert.ok(html.indexOf('Dofus Turquoise') < html.indexOf('Power Trophy'));
});

test('opening an explicit Crit optimizer result puts Turquoise in Workshop dofus-1', () => {
  const build = createWorkshopBuildFromOptimizerResult({ result: result('crit') });
  assert.equal(build.equipmentBySlot['dofus-1']?.name, 'Dofus Turquoise');
  assert.equal(build.equipmentBySlot['dofus-2']?.name, 'Power Trophy');
});
