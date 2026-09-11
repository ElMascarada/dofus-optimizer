import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { evaluateCompleteEquipmentBuild } from '../js/complete-equipment-build-evaluator.js';
import { statsWithStructuralExos } from '../js/structural-exos.js';

const SMALL_EARTH = { elements: ['earth'], profiles: ['small'] };

function character() {
  return {
    level: 200,
    characteristicPoints: 0,
    scrolled: {},
    baseStats: { ap: 7, mp: 3, vit: 1000 }
  };
}

function completeItems({ nativeCritDamage = false } = {}) {
  const slots = [
    'hat', 'cape', 'amulet', 'ring', 'ring', 'belt', 'boots', 'weapon', 'shield', 'companion',
    'dofus', 'dofus', 'dofus', 'dofus', 'dofus', 'dofus'
  ];
  let forgeableIndex = 0;
  return slots.map((slot, index) => {
    const forgeable = !['companion', 'dofus'].includes(slot);
    const stats = {};
    if (index === 0) Object.assign(stats, { ap: 4, mp: 2 });
    if (forgeable && nativeCritDamage) stats.critDamage = 1;
    if (forgeable) forgeableIndex++;
    return {
      id: `fm-${slot}-${index}-${forgeableIndex}`,
      name: `FM ${slot} ${index}`,
      slot,
      stats,
      conditions: null,
      setId: null
    };
  });
}

test('FM Oui means the search/evaluator context starts at 8 PA / 4 PM', () => {
  const start = statsWithStructuralExos({ ap: 7, mp: 3 }, { enabled: true });
  assert.equal(start.stats.ap, 8);
  assert.equal(start.stats.mp, 4);
  assert.equal(start.exoAp, 1);
  assert.equal(start.exoMp, 1);
});

test('FM Oui closes a 12/6 build that is only 11/5 without the structural pair', () => {
  const items = completeItems();
  const without = evaluateCompleteEquipmentBuild({
    items,
    constraints: { ap: 12, mp: 6 },
    syntheticOffense: SMALL_EARTH,
    character: character(),
    fmPolicy: { enabled: false }
  });
  assert.equal(without.result, null);
  assert.equal(without.reason, 'constraint');

  const withFm = evaluateCompleteEquipmentBuild({
    items,
    constraints: { ap: 12, mp: 6 },
    syntheticOffense: SMALL_EARTH,
    character: character(),
    fmPolicy: { enabled: true }
  });
  assert.ok(withFm.result);
  assert.equal(withFm.result.stats.ap, 12);
  assert.equal(withFm.result.stats.mp, 6);
  assert.equal(withFm.result.fm.enabled, true);
  assert.equal(withFm.result.fm.structuralSlots, 2);
  assert.equal(withFm.result.fm.offensiveSlots, 7);
  assert.equal(withFm.result.fm.spellPctItems + withFm.result.fm.critItems, 7);
  assert.equal(withFm.result.fm.assignments.filter((entry) => entry.type === 'exoAp').length, 1);
  assert.equal(withFm.result.fm.assignments.filter((entry) => entry.type === 'exoMp').length, 1);
});

test('seven offensive FM slots may choose +8 Do Crit when the item has no native Do Crit', () => {
  const evaluation = evaluateCompleteEquipmentBuild({
    items: completeItems(),
    constraints: { ap: 12, mp: 6 },
    syntheticOffense: SMALL_EARTH,
    character: character(),
    fmPolicy: { enabled: true }
  });
  assert.ok(evaluation.result);
  assert.equal(evaluation.result.fm.offensiveSlots, 7);
  assert.equal(evaluation.result.fm.critItems, 7);
  assert.equal(evaluation.result.fm.spellPctItems, 0);
  assert.equal(evaluation.result.stats.critDamage, 56);
});

test('native Do Crit makes +8 Do Crit ineligible and falls back to +1% spell damage', () => {
  const evaluation = evaluateCompleteEquipmentBuild({
    items: completeItems({ nativeCritDamage: true }),
    constraints: { ap: 12, mp: 6 },
    syntheticOffense: SMALL_EARTH,
    character: character(),
    fmPolicy: { enabled: true }
  });
  assert.ok(evaluation.result);
  assert.equal(evaluation.result.fm.offensiveSlots, 7);
  assert.equal(evaluation.result.fm.critItems, 0);
  assert.equal(evaluation.result.fm.spellPctItems, 7);
  assert.equal(evaluation.result.stats.spellDamagePct, 7);
});

test('Set-Core-First resource closure reads the FM-aware contextual stats', async () => {
  const source = await readFile(new URL('../optimizer/set-core-first-search.js', import.meta.url), 'utf8');
  assert.match(source, /function contextualBuildStats[\s\S]*statsWithStructuralExos\(staticBuildStats\(items, setsById\), fmPolicy\)/);
  assert.match(source, /function structuralPoolFor[\s\S]*contextualBuildStats\(baseItems, setsById, fmPolicy\)/);
  assert.match(source, /function requestedConstraintsClose[\s\S]*contextualBuildStats\(selected, setsById, fmPolicy\)/);
});
