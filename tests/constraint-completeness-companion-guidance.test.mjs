import test from 'node:test';
import assert from 'node:assert/strict';
import { searchConstraintCompletenessRescue } from '../js/constraint-completeness-rescue.js';

function item(id, slot, stats = {}, extra = {}) {
  return { id, name: id, level: 200, slot, setId: null, stats, passives: [], conditions: null,
    slotSubtype: null, typeName: slot, ...extra };
}
function defaultDofus() {
  return Array.from({ length: 6 }, (_, index) => item(`companion-dofus-${index + 1}`, 'dofus', { fire: 5 }, { typeName: 'Dofus' }));
}
function fixedShape({ hats, companions } = {}) {
  return [
    ...(hats || [item('companion-hat', 'hat', { ap: 1, fire: 10 })]),
    item('companion-cape', 'cape', { ap: 1, fire: 10 }),
    item('companion-amulet', 'amulet', { ap: 1, fire: 10 }),
    item('companion-ring-a', 'ring', { fire: 10 }), item('companion-ring-b', 'ring', { fire: 10 }),
    item('companion-belt', 'belt', { fire: 10 }), item('companion-boots', 'boots', { fire: 10 }),
    item('companion-weapon', 'weapon', { ap: 1, fire: 10 }), item('companion-shield', 'shield', { ap: 1, fire: 10 }),
    ...(companions || [item('companion-default', 'companion', { fire: 10 })]),
    ...defaultDofus()
  ];
}
function firstHint(output) {
  return output.diagnostics?.topCompanionExplorationHints?.[0]?.id || null;
}
function run(items, constraints, scenario = {}) {
  const spell = {
    id: 'companion-crit-fire', name: 'Companion crit fire', apCost: 3, baseCritPct: 0,
    hits: [{ element: 'fire', normal: [30, 30], crit: [70, 70] }]
  };
  return searchConstraintCompletenessRescue({
    items, sets: [],
    selections: [{ enabled: true, weight: 1, spell, casts: { 1: 1, 2: 0, 3: 0 } }],
    constraints,
    fmPolicy: { spellDamagePct: 0, allowCritDamage: false, critDamageAmount: 8, exoAp: 0, exoMp: 0 },
    turnMode: 't1', scenario: { requiredApByTurn: {}, ...scenario }, searchProfile: 'BALANCED',
    debugExplorationHints: true, useOffensiveBound: false
  });
}

const companions = [
  item('raw-offense-companion', 'companion', { fire: 90 }),
  item('crit-companion', 'companion', { crit: 100 }),
  item('vitality-companion', 'companion', { vit: 1400, fire: 10 })
];

test('contextual T1 companion guidance values Crit only while it increases expected damage', () => {
  const deficient = run(fixedShape({ hats: [item('companion-ap-hat', 'hat', { ap: 1 })], companions }), { ap: 12 });
  assert.equal(firstHint(deficient), 'crit-companion');

  const saturated = run(fixedShape({ hats: [item('companion-crit-ap-hat', 'hat', { ap: 1, crit: 100 })], companions }), { ap: 12 });
  assert.equal(firstHint(saturated), 'raw-offense-companion');
});

test('hard-floor companion usefulness remains ahead of contextual offense', () => {
  const vitality = run(fixedShape({ hats: [item('companion-vit-ap-hat', 'hat', { ap: 1 })], companions }), { ap: 12, vit: 3000 });
  assert.equal(firstHint(vitality), 'vitality-companion');
});

test('existing no-crit context gives Crit no offensive companion-ranking value', () => {
  const noCrit = run(fixedShape({ hats: [item('companion-no-crit-ap-hat', 'hat', { ap: 1 })], companions }), { ap: 12 }, { noCrit: true });
  assert.equal(firstHint(noCrit), 'raw-offense-companion');
  const critHint = noCrit.diagnostics.topCompanionExplorationHints.find((entry) => entry.id === 'crit-companion');
  assert.equal(Number(critHint?.expectedT1Gain || 0), 0);
});
