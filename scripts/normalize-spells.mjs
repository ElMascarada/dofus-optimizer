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

const rawVariantRecords = Array.isArray(variantsPayload?.references?.RefIds)
  ? variantsPayload.references.RefIds.filter((entry) => entry?.data).length
  : 0;

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

catalog.coverage.variantSourceRecords = rawVariantRecords;
if (rawVariantRecords > 0 && Number(catalog.coverage.variantSpellRefs || 0) === 0) {
  throw new Error(`Spell variants source contains ${rawVariantRecords} records but the normalizer extracted 0 variant spell references.`);
}

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
  `- SpellVariantData source records: ${rawVariantRecords}`,
  `- Variant spell references added: ${catalog.coverage.variantSpellRefs || 0}`,
  `- Certified variants: ${catalog.coverage.variantsCertified || 0}`,
  `- Offensive candidates detected: ${catalog.coverage.offensiveCandidates}`,
  `- Certified combat spells: ${catalog.coverage.certified}`,
  `- Spells with deterministic buff/debuff: ${catalog.coverage.combatModifierSpells || 0}`,
  `- Support-only spells: ${catalog.coverage.supportOnly || 0}`,
  `- Model: ${catalog.model}`,
  '',
  '## Coverage by class',
  '',
  ...byBreed.map((row) => `- ${row.name}: ${row.certified}/${row.source}`),
  '',
  '## Deterministic combat modifier samples',
  '',
  ...((catalog.coverage.modifierSamples || []).length
    ? catalog.coverage.modifierSamples.map((row) => `- ${row.breed} · ${row.spell}${row.variant ? ' [variant]' : ''}: ${JSON.stringify(row.modifiers)}`)
    : ['- none']),
  '',
  '## Skipped reasons',
  '',
  ...(skipped.length ? skipped.map(([reason, count]) => `- ${reason}: ${count}`) : ['- none']),
  '',
  '## Certification scope',
  '',
  '- Includes immediate fixed-element damage and life-steal hits at the highest spell level available to a level-200 character.',
  '- Includes class spell variants exposed by the Dofus SpellVariants dataset; normalization fails if the source contains variant records but none can be mapped.',
  '- Includes deterministic offensive self buffs and target damage-taken modifiers when their effect metadata is explicit.',
  '- Critical hits must match the normal hit count and elements.',
  '- Best-element, delayed, triggered or otherwise contextual damage is excluded rather than approximated.',
  '- Unsupported contextual secondary effects are ignored rather than invented.',
  ''
].join('\n');
await writeFile(new URL('spell-coverage-report.md', outDir), markdown);

console.log(`Normalized ${catalog.spells.length} certified combat spells across ${catalog.breeds.length} classes.`);
console.log(`Variants: ${catalog.coverage.variantsCertified || 0} certified from ${rawVariantRecords} SpellVariantData records.`);
console.log(`Spell coverage report: ${new URL('spell-coverage-report.md', outDir).pathname}`);
