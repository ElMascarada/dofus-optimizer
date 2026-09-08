import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const sourceTruth = JSON.parse(readFileSync(new URL('../data/normalized/spell-source-truth.json', import.meta.url), 'utf8'));
const requestedIds = [13118, 13156, 13124, 13110];

function sortedValue(value) {
  if (Array.isArray(value)) return value.map(sortedValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortedValue(value[key])]));
  }
  return value;
}

function fingerprint(source) {
  return createHash('sha256').update(JSON.stringify(sortedValue(source))).digest('hex');
}

function projectEffect(effect, kind, index) {
  return {
    occurrenceId: `${kind}:${index}:${effect.effectId}`,
    effectId: effect.effectId,
    order: effect.order,
    triggers: effect.triggers,
    duration: effect.duration,
    delay: effect.delay,
    targetMask: effect.targetMask,
    diceNum: effect.diceNum,
    diceSide: effect.diceSide,
    value: effect.value,
    sourceDescription: effect.sourceDescription,
    metadataJoinStatus: effect.metadataJoinStatus,
    effectMetadata: {
      id: effect.effectMetadata?.id ?? null,
      localizedDescription: effect.effectMetadata?.localizedDescription ?? null,
      characteristic: effect.effectMetadata?.characteristic ?? null,
      characteristicOperator: effect.effectMetadata?.characteristicOperator ?? null,
      elementId: effect.effectMetadata?.elementId ?? null
    }
  };
}

function projectLevel(source) {
  const level = source.level || {};
  const targeting = level.targeting || source.targeting || {};
  return {
    apCost: level.apCost ?? source.apCost ?? null,
    targeting: {
      maxCastPerTurn: targeting.maxCastPerTurn ?? null,
      maxCastPerTarget: targeting.maxCastPerTarget ?? null,
      minCastInterval: targeting.minCastInterval ?? null,
      initialCooldown: targeting.initialCooldown ?? null,
      globalCooldown: targeting.globalCooldown ?? null,
      criticalHitProbability: targeting.criticalHitProbability ?? null
    }
  };
}

function reportFor(source) {
  const effects = source.effects || [];
  const criticalEffects = source.criticalEffects || [];
  const bound = source.scripts?.bound || [];
  const stateReferences = source.stateReferences || [];
  return {
    id: source.id,
    name: source.name,
    sourceRecordSha256: fingerprint(source),
    level: projectLevel(source),
    effects: effects.map((effect, index) => projectEffect(effect, 'normal', index)),
    criticalEffects: criticalEffects.map((effect, index) => projectEffect(effect, 'critical', index)),
    scripts: {
      bound: bound.map((script, index) => ({
        occurrenceId: `bound:${index}:${script.scriptId ?? script.id}`,
        ...script
      }))
    },
    stateReferences,
    counts: {
      normalEffects: effects.length,
      criticalEffects: criticalEffects.length,
      boundScripts: bound.length,
      stateReferences: stateReferences.length
    }
  };
}

test('Iop T1 source extraction probe emits exact compact source evidence', () => {
  assert.ok(Array.isArray(sourceTruth.spells), 'schema-v2 source truth must contain spells[]');

  const selected = new Map();
  for (const id of requestedIds) {
    const matches = sourceTruth.spells.filter((entry) => entry.id === id);
    assert.equal(matches.length, 1, `requested spell ${id} must exist exactly once`);
    selected.set(id, matches[0]);
  }

  for (const id of requestedIds) {
    const report = reportFor(selected.get(id));
    console.log(`IOP_T1_SOURCE_REPORT=${JSON.stringify(report)}`);
    console.log(`NORMAL_EFFECT_COUNT=${report.counts.normalEffects}`);
    console.log(`CRITICAL_EFFECT_COUNT=${report.counts.criticalEffects}`);
    console.log(`BOUND_SCRIPT_COUNT=${report.counts.boundScripts}`);
    console.log(`STATE_REFERENCE_COUNT=${report.counts.stateReferences}`);
  }
});
