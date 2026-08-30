import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { normalizeSpellSourceTruth } from '../js/dofus-spell-source-truth.js';

const rawDir = new URL('../data/raw/', import.meta.url);
const outDir = new URL('../data/normalized/', import.meta.url);
await mkdir(outDir, { recursive: true });

async function readRaw(name) {
  return JSON.parse(await readFile(new URL(`${name}.json`, rawDir), 'utf8'));
}

const [
  spellsPayload,
  levelsPayload,
  variantsPayload,
  breedsPayload,
  pairsPayload,
  scriptsPayload,
  statesPayload,
  typesPayload,
  translationsPayload,
  version,
  runtimeCatalog
] = await Promise.all([
  readRaw('spells'),
  readRaw('spell_levels'),
  readRaw('spell_variants'),
  readRaw('breeds'),
  readRaw('spell_pairs'),
  readRaw('spell_scripts'),
  readRaw('spell_states'),
  readRaw('spell_types'),
  readRaw('fr'),
  readRaw('version'),
  JSON.parse(await readFile(new URL('../data/normalized/spell-data.json', import.meta.url), 'utf8'))
]);

const artifact = normalizeSpellSourceTruth({
  spellsPayload,
  levelsPayload,
  variantsPayload,
  breedsPayload,
  pairsPayload,
  scriptsPayload,
  statesPayload,
  typesPayload,
  translationsPayload,
  runtimeCatalog,
  gameVersion: version,
  generatedAt: version?.update_stamp || null,
  characterLevel: 200
});

const output = new URL('spell-source-truth.json', outDir);
await writeFile(output, `${JSON.stringify(artifact, null, 2)}\n`);
console.log(JSON.stringify(artifact.coverage));
console.log(`Spell source truth: ${output.pathname}`);
