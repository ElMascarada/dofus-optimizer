const SLOT_POOL_TARGETS = Object.freeze({
  dofus: 28,
  ring: 20,
  companion: 22,
  weapon: 20,
  hat: 18,
  cape: 18,
  amulet: 18,
  belt: 18,
  boots: 18,
  shield: 18
});

const GROUP_CHOICE_LIMITS = Object.freeze({
  dofus: 160,
  ring: 36,
  companion: 18,
  weapon: 12,
  hat: 12,
  cape: 12,
  amulet: 12,
  belt: 12,
  boots: 12,
  shield: 12
});

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function profile({
  candidateScale = 1,
  searchScale = 1,
  refineScale = 1,
  combatScale = 1,
  evaluationScale = 1
} = {}) {
  const scaledSlots = Object.fromEntries(Object.entries(SLOT_POOL_TARGETS)
    .map(([slot, value]) => [slot, Math.max(1, Math.round(value * candidateScale))]));
  const scaledChoices = Object.fromEntries(Object.entries(GROUP_CHOICE_LIMITS)
    .map(([slot, value]) => [slot, Math.max(1, Math.round(value * searchScale))]));

  return deepFreeze({
    candidate: {
      slotPoolTargets: scaledSlots,
      specialistReservePerCategory: Math.max(2, Math.round(4 * candidateScale)),
      constraintReservePerStat: Math.max(4, Math.round(8 * candidateScale)),
      offensiveRankReserve: Math.max(4, Math.round(10 * candidateScale)),
      setCoreReservePerPlan: Math.max(2, Math.round(4 * candidateScale)),
      maxSetCorePlans: Math.max(4, Math.round(10 * candidateScale)),
      paretoSoftLimit: Math.max(8, Math.round(28 * candidateScale))
    },
    ranking: {
      objectiveWeight: 1000,
      constraintWeight: 1000000,
      targetWeight: 2,
      genericWeight: 1,
      constraintProgressWeight: 1000000
    },
    setPlanning: {
      architectureBeamWidth: Math.max(200, Math.round(700 * searchScale)),
      bonusRankWeight: 0.8,
      activationWeight: Math.max(2000, Math.round(4500 * searchScale)),
      pieceCountWeight: Math.max(1500, Math.round(3500 * searchScale)),
      largeSetBonus: Math.max(4000, Math.round(9000 * searchScale)),
      threeThreeThreeBonus: Math.max(8000, Math.round(18000 * searchScale)),
      threeTwoTwoTwoBonus: Math.max(7000, Math.round(16000 * searchScale)),
      apBonusWeight: Math.max(30000, Math.round(60000 * searchScale)),
      mpBonusWeight: Math.max(20000, Math.round(40000 * searchScale))
    },
    search: {
      groupChoiceLimits: scaledChoices,
      groupBeamWidth: Math.max(80, Math.round(160 * searchScale)),
      multiPickBeamWidth: Math.max(120, Math.round(260 * searchScale)),
      dofusGroupBeamWidth: Math.max(220, Math.round(620 * searchScale)),
      groupBucketLimit: Math.max(12, Math.round(36 * searchScale)),
      groupDiversityMultiplier: 8,
      groupSpecialistReservePerStat: Math.max(1, Math.round(2 * searchScale)),
      groupOffenseReserve: Math.max(24, Math.round(64 * searchScale)),
      stateBeamWidth: Math.max(100, Math.round(220 * searchScale)),
      dofusStateBeamWidth: Math.max(120, Math.round(260 * searchScale)),
      stateBucketLimit: Math.max(4, Math.round(10 * searchScale)),
      evaluationLimit: Math.max(24, Math.round(64 * evaluationScale)),
      constrainedEvaluationLimit: Math.max(32, Math.round(96 * evaluationScale)),
      architectureMaxPlans: Math.max(12, Math.round(24 * searchScale)),
      constrainedArchitectureMaxPlans: Math.max(16, Math.round(30 * searchScale)),
      architectureMaxCount: Math.max(36, Math.round(90 * searchScale)),
      // Canonical cores already enumerate the useful 2/3/4-piece alternatives.
      // Mutating each one into near-standalone lanes only repeats work that the
      // explicit standalone search performs, so keep the exact core lane only.
      mutationLimit: 1
    },
    refine: {
      maxSkeletons: Math.max(4, Math.round(10 * refineScale)),
      dofusComboLimit: Math.max(32, Math.round(72 * refineScale))
    },
    worker: {
      structureCombatScoreFloor: Math.max(30, Math.round(60 * searchScale)),
      structureCombatDiversityFloor: Math.max(45, Math.round(90 * searchScale)),
      structureCombatScoreMultiplier: 6,
      structureCombatDiversityMultiplier: 9,
      structureNonCombatDiversityFloor: Math.max(25, Math.round(50 * searchScale)),
      structureNonCombatDiversityMultiplier: 5,
      multiFeedbackFloor: Math.max(10, Math.round(20 * searchScale)),
      multiFeedbackMultiplier: 2,
      singleFeedbackFloor: Math.max(25, Math.round(50 * searchScale)),
      singleFeedbackMultiplier: 5,
      feedbackSelectionMulti: Math.max(4, Math.round(8 * searchScale)),
      feedbackSelectionSingle: Math.max(5, Math.round(10 * searchScale)),
      multiFeedbackRefineFloor: Math.max(15, Math.round(30 * searchScale)),
      multiFeedbackRefineMultiplier: 3,
      singleFeedbackRefineFloor: Math.max(30, Math.round(60 * searchScale)),
      singleFeedbackRefineMultiplier: 6,
      multiMergeFloor: Math.max(18, Math.round(36 * searchScale)),
      multiMergeMultiplier: 4,
      singleMergeFloor: Math.max(35, Math.round(70 * searchScale)),
      singleMergeMultiplier: 7
    },
    combat: {
      maxActionsPerTurn: 12,
      singleTurnBeamWidth: Math.max(400, Math.round(1400 * combatScale)),
      singleTurnInterTurnWidth: Math.max(8, Math.round(24 * combatScale)),
      singleTurnWorkingSetFloor: Math.max(18, Math.round(30 * combatScale)),
      singleTurnWorkingSetMultiplier: 3,
      multiInputFloor: Math.max(12, Math.round(24 * combatScale)),
      multiInputCeiling: Math.max(18, Math.round(36 * combatScale)),
      multiInputMultiplier: 2,
      prysmaReserveFloor: Math.max(2, Math.round(4 * combatScale)),
      prysmaReserveDivisor: 3,
      coarseBeamWidth: Math.max(45, Math.round(90 * combatScale)),
      coarseInterTurnWidth: Math.max(3, Math.round(6 * combatScale)),
      preciseBeamWidth: Math.max(210, Math.round(420 * combatScale)),
      preciseInterTurnWidth: Math.max(6, Math.round(12 * combatScale)),
      coarseKeepFloor: Math.max(10, Math.round(20 * combatScale)),
      coarseKeepMultiplier: 2,
      preciseCandidateFloor: Math.max(5, Math.round(10 * combatScale)),
      preciseCandidateCeiling: Math.max(7, Math.round(14 * combatScale)),
      preciseWorkingSetFloor: Math.max(10, Math.round(20 * combatScale)),
      preciseWorkingSetMultiplier: 2
    }
  });
}

export const SEARCH_PROFILES = deepFreeze({
  FAST: profile({ candidateScale: 0.8, searchScale: 0.65, refineScale: 0.65, combatScale: 0.65, evaluationScale: 0.65 }),
  BALANCED: profile(),
  PRECISE: profile({ candidateScale: 1.2, searchScale: 1.35, refineScale: 1.25, combatScale: 1.2, evaluationScale: 1.35 }),
  FINAL: profile({ candidateScale: 1.5, searchScale: 1.8, refineScale: 1.6, combatScale: 1.5, evaluationScale: 1.8 })
});

export const DEFAULT_SEARCH_PROFILE_NAME = 'BALANCED';
export const DEFAULT_SEARCH_PROFILE = SEARCH_PROFILES[DEFAULT_SEARCH_PROFILE_NAME];

export function getSearchProfile(value = DEFAULT_SEARCH_PROFILE_NAME) {
  if (value && typeof value === 'object' && value.candidate && value.search) return value;
  const key = String(value || DEFAULT_SEARCH_PROFILE_NAME).toUpperCase();
  return SEARCH_PROFILES[key] || DEFAULT_SEARCH_PROFILE;
}

export function withCandidateOverrides(profileValue, overrides = {}) {
  const base = getSearchProfile(profileValue);
  return deepFreeze({
    ...base,
    candidate: {
      ...base.candidate,
      ...overrides,
      slotPoolTargets: {
        ...base.candidate.slotPoolTargets,
        ...(overrides.slotPoolTargets || {})
      }
    }
  });
}
