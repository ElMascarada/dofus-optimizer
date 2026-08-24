import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { normalizeDofusSpellCatalog } from '../js/dofus-spell-normalizer.js';

const rawDir = new URL('../data/raw/', import.meta.url);
const outDir = new URL('../data/normalized/', import.meta.url);
await mkdir(outDir, { recursive: true });

async function readJson(name) {
  return JSON.parse(await readFile(new URL(`${name}.json`, rawDir), 'utf8'));
}

const [spellsPayload, levelsPayload, variantsPayload, breedsPayload, effectsPayload, translationsPayload, version] = await Promise.all([
  readJson('spells'),
  readJson('spell_levels'),
  readJson('spell_variants'),
  readJson('breeds'),
  readJson('effects'),
  readJson('fr'),
  readJson('version')
]);

const catalog = normalizeDofusSpellCatalog({
  spellsPayload,
  levelsPayload,
  variantsPayload,
  breedsPayload,
  effectsPayload,
  translationsPayload,
  gameVersion: version,
  generatedAt: version?.update_stamp || null,
  characterLevel: 200
});

await writeFile(new URL('spell-data.json', outDir), JSON.stringify(catalog));
await writeFile(new URL('spell-coverage-report.json', outDir), JSON.stringify(catalog.coverage, null, 2));

const byBreed = catalog.breeds.map((breed) => ({
  name: breed.name,
  certified: breed.certifiedSpellCount,
  source: breed.sourceSpellCount
}));
const skipped = Object.entries(catalog.coverage.skipped || {}).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
const markdown = [
  '# Dofus spell normalization coverage',
  '',
  `- Generated: ${catalog.generatedAt || 'unknown'}`,
  `- Game version: ${version?.version || 'unknown'} (${version?.release || 'unknown'})`,
  `- Classes: ${catalog.coverage.breedCount}`,
  `- Class spell references: ${catalog.coverage.classSpellRefs}`,
  `- Variant spell references added: ${catalog.coverage.variantSpellRefs || 0}`,
  `- Offensive candidates detected: ${catalog.coverage.offensiveCandidates}`,
  `- Certified direct fixed-element spells: ${catalog.coverage.certified}`,
  `- Model: ${catalog.model}`,
  '',
  '## Coverage by class',
  '',
  ...byBreed.map((row) => `- ${row.name}: ${row.certified}/${row.source}`),
  '',
  '## Skipped reasons',
  '',
  ...(skipped.length ? skipped.map(([reason, count]) => `- ${reason}: ${count}`) : ['- none']),
  '',
  '## Certification scope',
  '',
  '- Includes immediate fixed-element damage and life-steal hits at the highest spell level available to a level-200 character.',
  '- Includes class spell variants exposed by the Dofus SpellVariants dataset.',
  '- Critical hits must match the normal hit count and elements.',
  '- Best-element, delayed, triggered or otherwise contextual damage is excluded rather than approximated.',
  '- Non-damage secondary effects are not included in the damage objective.',
  ''
].join('\n');
await writeFile(new URL('spell-coverage-report.md', outDir), markdown);

console.log(`Normalized ${catalog.spells.length} certified direct-damage spells across ${catalog.breeds.length} classes.`);
console.log(`Spell coverage report: ${new URL('spell-coverage-report.md', outDir).pathname}`);
