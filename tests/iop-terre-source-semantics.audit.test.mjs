import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const sourceTruthPath = new URL('../data/normalized/spell-source-truth.json', import.meta.url);
const SPELL_IDS = [13106, 13123, 13125, 13146, 13118, 13138];

test('diagnostic: dump complete Iop Terre source truth records', async () => {
  const artifact = JSON.parse(await readFile(sourceTruthPath, 'utf8'));
  for (const id of SPELL_IDS) {
    const spell = artifact.spells.find((entry) => entry.id === id);
    assert.ok(spell, `spell ${id} must exist in source truth`);
    console.log(`IOP_TERRE_SOURCE_BEGIN=${id}`);
    console.log(JSON.stringify(spell));
    console.log(`IOP_TERRE_SOURCE_END=${id}`);
  }
});
