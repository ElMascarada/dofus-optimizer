import test from 'node:test';
import assert from 'node:assert/strict';
import { searchConstraintCompletenessRescue } from '../js/constraint-completeness-rescue.js';

function item(id, slot, stats = {}, extra = {}) {
  return {
    id, name: id, level: 200, slot, setId: null, stats,
    passives: [], effects: [], conditions: null, turnBonuses: {}, pendingDynamicEffects: [],
    slotSubtype: null, typeName: slot === 'dofus' ? 'Dofus' : slot, ...extra
  };
}

function dofusCandidates() {
  return [
    item('candidate-crit', 'dofus', { crit: 50 }),
    item('candidate-power', 'dofus', { power: 100 }),
    ...Array.from({ length: 5 }, (_, index) => item(`candidate-fill-${index}`, 'dofus', {}))
  ];
}

function fixedShape({ hatStats = { ap: 1 }, dofuses = dofusCandidates() } = {}) {
  return [
    item('fixed-hat', 'hat', hatStats),
    item('fixed-cape', 'cape', { ap: 1, fire: 10 }),
    item('fixed-amulet', 'amulet', { ap: 1, fire: 10 }),
    item('fixed-ring-a', 'ring', { fire: 10 }),
    item('fixed-ring-b', 'ring', { fire: 10 }),
    item('fixed-belt', 'belt', { fire: 10 }),
    item('fixed-boots', 'boots', { fire: 10 }),
    item('fixed-weapon', 'weapon', { ap: 1, fire: 10 }),
    item('fixed-shield', 'shield', { ap: 1, fire: 10 }),
    item('fixed-companion', 'companion', { fire: 10 }),
    ...dofuses
  ];
}

const spell = {
  id: 'generic-crit-context', name: 'Generic crit context', apCost: 3, baseCritPct: 0,
  hits: [{ element: 'fire', normal: [30, 30], crit: [40, 40] }]
};

function run(items, constraints = { ap: 12 }) {
  return searchConstraintCompletenessRescue({
    items,
    sets: [],
    selections: [{ enabled: true, weight: 1, spell, casts: { 1: 1, 2: 0, 3: 0 } }],
    constraints,
    fmPolicy: { spellDamagePct: 0, allowCritDamage: false, critDamageAmount: 8, exoAp: 0, exoMp: 0 },
    turnMode: 't1', scenario: { requiredApByTurn: {} }, searchProfile: 'BALANCED',
    debugExplorationHints: true, useOffensiveBound: false
  });
}

function hints(output) {
  return output.diagnostics?.topDofusExplorationHints || [];
}

test('contextual Dofus guidance prefers Crit when existing CritDamage makes canonical expected T1 larger', () => {
  const output = run(fixedShape({ hatStats: { ap: 1, critDamage: 114 } }));
  const list = hints(output);
  const crit = list.find((entry) => entry.id === 'candidate-crit');
  const power = list.find((entry) => entry.id === 'candidate-power');

  assert.equal(list[0]?.id, 'candidate-crit');
  assert.ok(Number(crit?.expectedT1Gain || 0) > Number(power?.expectedT1Gain || 0));
});

test('contextual Dofus guidance can prefer Power when CritDamage context is absent', () => {
  const output = run(fixedShape({ hatStats: { ap: 1 } }));
  const list = hints(output);
  const crit = list.find((entry) => entry.id === 'candidate-crit');
  const power = list.find((entry) => entry.id === 'candidate-power');

  assert.equal(list[0]?.id, 'candidate-power');
  assert.ok(Number(power?.expectedT1Gain || 0) > Number(crit?.expectedT1Gain || 0));
});

test('hard-floor deficit remains ahead of contextual Dofus offense', () => {
  const dofuses = [item('candidate-floor', 'dofus', { ap: 1 }), ...dofusCandidates()];
  const output = run(fixedShape({ hatStats: { critDamage: 114 }, dofuses }), { ap: 12 });
  assert.equal(hints(output)[0]?.id, 'candidate-floor');
});
