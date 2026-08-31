import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { validateDofusSnapshot, validateSpellSnapshot } from '../js/data-loader.js';
import { createOptimizerV2Request } from '../js/optimizer-v2-orchestrator.js';
import { evaluateCompleteBuild } from '../js/complete-build-evaluator.js';
import { buildCombatFeedbackSelections } from '../js/combat-feedback.js';
import {
  createCanonicalT1CombatContext,
  evaluateCanonicalT1Combat,
  spellsForCanonicalT1Context
} from '../js/combat-evaluation-context.js';
import { GENERIC_OFFENSE_KEYS } from '../optimizer/candidate-policy.js';

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
  topN: 5
});

const IGNORED_COMPLEX_DOFUS_PASSIVES = [
  'deep-purple',
  'turquoise-blue',
  'vermilion-red',
  'yellow-ochre',
  'descent-to-abyss'
];

function spellMatchesElement(spell, element = 'multi') {
  if (element === 'multi' || !element) return Array.isArray(spell?.hits) && spell.hits.length > 0;
  return (spell?.hits || []).some((hit) => hit?.element === element);
}

function combatSpellPool(classSpells = [], element = 'multi') {
  return (classSpells || []).filter((spell) => {
    const support = (Array.isArray(spell?.combatModifiers) && spell.combatModifiers.length > 0)
      || (Array.isArray(spell?.delayedCombatModifiers) && spell.delayedCombatModifiers.length > 0)
      || Boolean(spell?.selfCharge);
    return support || spellMatchesElement(spell, element);
  });
}

function gearSelectionsForT1(spells = [], element = 'multi') {
  return (spells || [])
    .filter((spell) => spellMatchesElement(spell, element))
    .map((spell) => ({
      spell: { ...spell },
      enabled: true,
      weight: 1,
      casts: { 1: 1, 2: 0, 3: 0 }
    }));
}

const combatSpells = combatSpellPool(request.classSpells || [], 'fire');
const gearSelections = gearSelectionsForT1(combatSpells, 'fire');
const workerScenario = {
  ...(request.scenario || {}),
  requiredApByTurn: {},
  ignoredPassiveIds: [
    ...new Set([...(request.scenario?.ignoredPassiveIds || []), ...IGNORED_COMPLEX_DOFUS_PASSIVES])
  ]
};

let workerHandler = null;
const workerMessages = [];
let workerProductionCalls = 0;

globalThis.self = {
  addEventListener(type, handler) {
    if (type !== 'message') return;
    assert.equal(workerHandler, null, 'plusieurs handlers Worker inattendus');
    workerHandler = handler;
  },
  postMessage(message) {
    workerMessages.push(message);
  }
};

await import('../js/optimizer-worker.js');
assert.equal(typeof workerHandler, 'function', 'handler Worker production introuvable');

workerProductionCalls += 1;
workerHandler({
  data: {
    type: 'optimize',
    requestId: 't1-recovery-slice1-post-fix',
    payload: request
  }
});

assert.equal(workerProductionCalls, 1, 'exactement un appel Worker production attendu');
const terminal = workerMessages.findLast((message) =>
  message?.requestId === 't1-recovery-slice1-post-fix'
  && (message?.type === 'result' || message?.type === 'error'));
assert.ok(terminal, 'aucune réponse terminale Worker');
if (terminal.type === 'error') throw new Error(`Worker production: ${terminal.message}`);

const output = terminal.output || {};
const results = (output.results || []).slice(0, 5);
assert.ok(results.length > 0, 'Worker production sans résultat');

function num(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildLegalityCheck(result) {
  const context = result?.canonicalCombatContext;
  const contextSpells = spellsForCanonicalT1Context(context, spellData);
  const feedbackSelections = contextSpells.length
    ? buildCombatFeedbackSelections({ results: [result], spells: contextSpells, turnMode: 't1', maxPlans: 1 })
    : [];
  const evaluation = evaluateCompleteBuild({
    items: result.items || [],
    sets: request.sets || [],
    selections: feedbackSelections.length ? feedbackSelections : gearSelections,
    constraints: request.constraints,
    fmPolicy: request.fmPolicy,
    turnMode: 't1',
    scenario: context?.scenario || workerScenario
  });
  return {
    legal: Boolean(evaluation.result),
    reason: evaluation.reason || null
  };
}

const top = results.map((result, index) => {
  const staticAp = num(result?.stats?.ap);
  const dynamicT1Ap = num(result?.effectiveStatsByTurn?.[1]?.ap ?? staticAp);
  const legality = buildLegalityCheck(result);
  assert.ok(staticAp <= 12, `rank ${index + 1}: PA permanents ${staticAp} > 12`);
  assert.ok(legality.legal, `rank ${index + 1}: build post-fix illégal (${legality.reason})`);
  return {
    rank: index + 1,
    score: num(result?.score),
    staticAp,
    dynamicT1Ap,
    legal: legality.legal,
    items: (result.items || []).map((item) => ({ id: String(item.id), name: item.name, slot: item.slot }))
  };
});

const offenseKeys = new Set([...GENERIC_OFFENSE_KEYS, 'fire', 'damageFire']);

function positiveOffense(stats = {}) {
  return [...offenseKeys].some((key) => num(stats?.[key]) > 0);
}

function hasOffensivePotential(item = {}) {
  if (positiveOffense(item.stats || {})) return true;
  if (Object.values(item.turnBonuses || {}).some((stats) => positiveOffense(stats || {}))) return true;
  return Boolean(
    (item.passives || []).length
    || (item.effects || []).length
    || (item.pendingDynamicEffects || []).length
    || item.slotSubtype === 'prysmaradite'
  );
}

function closeEnough(left, right) {
  return Math.abs(num(left) - num(right)) <= 1e-6;
}

const robustCounterfactuals = [];
for (let index = 0; index < results.length; index++) {
  const result = results[index];
  const robustIndex = (result.items || []).findIndex((item) => item?.name === 'Robuste majeur');
  if (robustIndex < 0) continue;

  const context = result.canonicalCombatContext;
  const spells = spellsForCanonicalT1Context(context, spellData);
  assert.ok(spells.length > 0, `rank ${index + 1}: contexte T1 canonique absent`);
  const robustPlan = evaluateCanonicalT1Combat({ context, spells });
  const robustDamage = num(robustPlan.score);
  assert.ok(closeEnough(robustDamage, result.score), `rank ${index + 1}: score Worker != vérité T1 canonique`);

  const feedbackSelections = buildCombatFeedbackSelections({
    results: [result],
    spells,
    turnMode: 't1',
    maxPlans: 1
  });
  const equippedIds = new Set((result.items || []).map((item) => String(item.id)));
  const candidates = (request.items || []).filter((item) =>
    item?.slot === 'dofus'
    && item?.name !== 'Robuste majeur'
    && !equippedIds.has(String(item.id))
    && hasOffensivePotential(item));

  let best = null;
  let legalReplacementCount = 0;
  for (const replacement of candidates) {
    const replacementItems = [...result.items];
    replacementItems[robustIndex] = replacement;
    const evaluation = evaluateCompleteBuild({
      items: replacementItems,
      sets: request.sets || [],
      selections: feedbackSelections.length ? feedbackSelections : gearSelections,
      constraints: request.constraints,
      fmPolicy: request.fmPolicy,
      turnMode: 't1',
      scenario: context?.scenario || workerScenario
    });
    if (!evaluation.result) continue;
    legalReplacementCount += 1;

    const replacementContext = createCanonicalT1CombatContext({
      classId: context.classId,
      element: context.element,
      combatObjective: context.combatObjective,
      scenario: context.scenario,
      spellIds: context.spellIds,
      stats: evaluation.result.stats,
      effectiveStatsByTurn: evaluation.result.effectiveStatsByTurn,
      fm: evaluation.result.fm,
      searchProfile: context.searchProfile
    });
    const plan = evaluateCanonicalT1Combat({ context: replacementContext, spells });
    const damage = num(plan.score);
    if (!best || damage > best.damage) {
      best = {
        id: String(replacement.id),
        name: replacement.name,
        damage
      };
    }
  }

  const bestDamage = num(best?.damage ?? robustDamage);
  robustCounterfactuals.push({
    rank: index + 1,
    robustDamage,
    bestLegalReplacement: best?.name || 'NONE',
    bestLegalReplacementId: best?.id || null,
    replacementDamage: bestDamage,
    delta: bestDamage - robustDamage,
    dominated: bestDamage > robustDamage + 1e-6,
    offensiveCandidatesChecked: candidates.length,
    legalReplacementCount
  });
}

const currentRobusteProductFailure = robustCounterfactuals.some((entry) => entry.dominated)
  ? 'CONFIRMED'
  : 'NOT_REPRODUCED';

const report = {
  workerProductionCalls,
  resultCount: results.length,
  top,
  topWithRobuste: robustCounterfactuals.map((entry) => entry.rank),
  robustCounterfactuals,
  currentRobusteProductFailure,
  diagnostics: output.diagnostics || null
};

console.log(`T1_RECOVERY_AUDIT=${JSON.stringify(report)}`);
