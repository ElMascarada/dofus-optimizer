import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const sourceTruthPath = new URL('../data/normalized/spell-source-truth.json', import.meta.url);
const SPELL_IDS = [13106, 13123, 13125, 13146, 13118, 13138];

function effectSummary(effect) {
  return {
    effectId: effect.effectId,
    order: effect.order,
    triggers: effect.triggers,
    duration: effect.duration,
    delay: effect.delay,
    targetMask: effect.targetMask,
    diceNum: effect.diceNum,
    diceSide: effect.diceSide,
    value: effect.value,
    zoneDescr: effect.zoneDescr,
    random: effect.random,
    randomGroup: effect.randomGroup,
    group: effect.group,
    effectMetadata: effect.effectMetadata,
    metadataJoinStatus: effect.metadataJoinStatus,
    sourceDescription: effect.sourceDescription,
  };
}

test('diagnostic: dump compact complete Iop Terre source truth semantics inputs', async () => {
  const artifact = JSON.parse(await readFile(sourceTruthPath, 'utf8'));
  for (const id of SPELL_IDS) {
    const spell = artifact.spells.find((entry) => entry.id === id);
    assert.ok(spell, `spell ${id} must exist in source truth`);
    const scriptAndStateFields = Object.fromEntries(
      Object.entries(spell).filter(([key]) => /script|state/i.test(key)),
    );
    console.log(`IOP_TERRE_SOURCE=${JSON.stringify({
      id: spell.id,
      name: spell.name,
      level: spell.level,
      effects: (spell.effects ?? []).map(effectSummary),
      criticalEffects: (spell.criticalEffects ?? []).map(effectSummary),
      ...scriptAndStateFields,
      sourceTruth: spell.sourceTruth,
    })}`);
  }
});
