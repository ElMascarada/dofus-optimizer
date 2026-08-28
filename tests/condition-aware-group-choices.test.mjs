import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CONDITION_FEASIBILITY,
  analyzeNormalizedConditionFeasibility
} from '../js/build-legality.js';
import { buildGroupChoices } from '../optimizer/candidate-search.js';

const impossibleApMpCondition = {
  kind: 'relation',
  relation: 'or',
  children: [
    { kind: 'condition', stat: 'ap', operator: 'lt', value: 12 },
    { kind: 'condition', stat: 'mp', operator: 'lt', value: 6 }
  ]
};

const unresolvedSetBonusCondition = {
  kind: 'condition',
  stat: 'setBonus',
  operator: 'lt',
  value: 3
};

function item(id, power, conditions = null) {
  return {
    id,
    name: id,
    slot: 'dofus',
    level: 200,
    stats: { power },
    ...(conditions ? { conditions } : {})
  };
}

function profileItem(entry) {
  return {
    item: entry,
    optimisticStats: { ...entry.stats },
    bounded: true,
    rankScore: Number(entry.stats?.power || 0) * 1000,
    objectiveGain: Number(entry.stats?.power || 0)
  };
}

function context(overrides = {}) {
  const constraints = { ap: 12, mp: 6 };
  const profile = {
    ranking: { constraintWeight: 0 },
    search: {
      dofusGroupBeamWidth: 2,
      multiPickBeamWidth: 2,
      groupBeamWidth: 2,
      groupBucketLimit: 1,
      groupDiversityMultiplier: 2,
      groupSpecialistReservePerStat: 0,
      groupOffenseReserve: 1,
      groupChoiceLimits: { dofus: 2 }
    }
  };
  const policy = {
    paretoKeys: [],
    rankStats(stats = {}) {
      const power = Number(stats.power || 0);
      return {
        objectiveGain: power,
        constraintSignal: 0,
        rankScore: power * 1000
      };
    }
  };
  return { constraints, profile, policy, slot: 'dofus', ...overrides };
}

function choiceIds(choice) {
  return choice.items.map((entry) => String(entry.id)).sort();
}

test('condition-aware multi-pick retention prevents provably impossible high-score items from evicting the legal route', () => {
  const entries = [
    item('impossible-a', 120, impossibleApMpCondition),
    item('impossible-b', 119, impossibleApMpCondition),
    item('impossible-c', 118, impossibleApMpCondition),
    item('safe-a', 110),
    item('safe-b', 109)
  ];
  const profiles = entries.map(profileItem);

  // Legacy score-only first-pick retention with this width is completely
  // occupied by mathematically impossible candidates, so safe-a/safe-b cannot
  // ever be composed on the next pick.
  const legacyFirstPick = [...profiles]
    .sort((a, b) => b.rankScore - a.rankScore)
    .slice(0, 2)
    .map((entry) => entry.item.id);
  assert.deepEqual(legacyFirstPick, ['impossible-a', 'impossible-b']);

  const choices = buildGroupChoices(profiles, 2, context());
  assert.ok(
    choices.some((choice) => choiceIds(choice).join('|') === 'safe-a|safe-b'),
    'the only legal conditionless pair must survive the unchanged width-2 beam'
  );
  assert.ok(
    choices.every((choice) => choice.items.every((entry) => !String(entry.id).startsWith('impossible-'))),
    'provably impossible items must not consume group-choice capacity'
  );
  assert.ok(choices.length <= 2, 'the fix must not increase the configured group choice limit');
});

test('setBonus < 3 remains unresolved and retainable beside conditionless choices', () => {
  assert.equal(
    analyzeNormalizedConditionFeasibility(unresolvedSetBonusCondition, {
      minimums: { ap: 12, mp: 6 }
    }).classification,
    CONDITION_FEASIBILITY.UNRESOLVED
  );

  const trophy = item('set-bonus-trophy', 115, unresolvedSetBonusCondition);
  const safeA = item('safe-a', 110);
  const safeB = item('safe-b', 109);
  const choices = buildGroupChoices([trophy, safeA, safeB].map(profileItem), 2, context());

  assert.ok(
    choices.some((choice) => choice.items.some((entry) => entry.id === 'set-bonus-trophy')),
    'an unresolved setBonus condition must keep a route in the beam'
  );
  assert.ok(
    choices.some((choice) => choiceIds(choice).join('|') === 'safe-a|safe-b'),
    'conditionless diversity must coexist with unresolved conditional routes'
  );
  assert.ok(choices.length <= 2, 'unresolved diversity must consume, not enlarge, the existing beam');
});

test('conditionless reserve keeps a strong representative for a weak-isolation Pareto specialist', () => {
  const specialist = {
    ...item('melee-specialist', 10),
    stats: { power: 10, meleeDamagePct: 6 }
  };
  const safeA = item('safe-a', 120);
  const safeB = item('safe-b', 119);
  const base = context();
  const specialistContext = {
    ...base,
    profile: {
      ...base.profile,
      search: {
        ...base.profile.search,
        groupSpecialistReservePerStat: 1,
        groupOffenseReserve: 2
      }
    },
    policy: {
      ...base.policy,
      paretoKeys: ['meleeDamagePct', 'power']
    }
  };

  const choices = buildGroupChoices([safeA, safeB, specialist].map(profileItem), 2, specialistContext);
  assert.ok(
    choices.some((choice) => choiceIds(choice).join('|') === 'melee-specialist|safe-a'),
    'the fixed conditionless lane must represent the melee specialist instead of filling only by aggregate score'
  );
  assert.ok(choices.length <= 2, 'specialist diversity must stay inside the existing beam width');
});
