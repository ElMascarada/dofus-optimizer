import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { normalizeDofusSpellCatalog } from '../js/dofus-spell-normalizer.js';
import { normalizeDofusSpellSourceTruth } from '../js/dofus-spell-source-truth.js';

const rawDir = new URL('../data/raw/', import.meta.url);
const outDir = new URL('../data/normalized/', import.meta.url);
await mkdir(outDir, { recursive: true });

async function readJson(name) {
  return JSON.parse(await readFile(new URL(`${name}.json`, rawDir), 'utf8'));
}

const [
  spellsPayload,
  levelsPayload,
  variantsPayload,
  breedsPayload,
  effectsPayload,
  translationsPayload,
  spellPairsPayload,
  spellScriptsPayload,
  spellStatesPayload,
  spellTypesPayload,
  version
] = await Promise.all([
  readJson('spells'),
  readJson('spell_levels'),
  readJson('spell_variants'),
  readJson('breeds'),
  readJson('effects'),
  readJson('fr'),
  readJson('spell_pairs'),
  readJson('spell_scripts'),
  readJson('spell_states'),
  readJson('spell_types'),
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

const sourceTruth = normalizeDofusSpellSourceTruth({
  spellsPayload,
  levelsPayload,
  variantsPayload,
  breedsPayload,
  effectsPayload,
  translationsPayload,
  spellPairsPayload,
  spellScriptsPayload,
  spellStatesPayload,
  spellTypesPayload,
  gameVersion: version,
  generatedAt: version?.update_stamp || null
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

await writeFile(new URL('spell-source-truth.json', outDir), JSON.stringify(sourceTruth));
await writeFile(new URL('spell-source-truth-coverage.json', outDir), JSON.stringify(sourceTruth.coverage, null, 2));

const sourceTruthMarkdown = [
  '# Dofus spell source truth coverage',
  '',
  `- Generated: ${sourceTruth.source.generatedAt || 'unknown'}`,
  `- Game version: ${version?.version || 'unknown'} (${version?.release || 'unknown'})`,
  `- spellCount=${sourceTruth.coverage.spellCount}`,
  `- spellLevelCount=${sourceTruth.coverage.spellLevelCount}`,
  `- effectInstanceCount=${sourceTruth.coverage.effectInstanceCount}`,
  `- runtimeKnownEffectCount=${sourceTruth.coverage.runtimeKnownEffectCount}`,
  `- structuralOnlyEffectCount=${sourceTruth.coverage.structuralOnlyEffectCount}`,
  `- unresolvedEffectCount=${sourceTruth.coverage.unresolvedEffectCount}`,
  `- additionalAssetsLoaded=${Object.entries(sourceTruth.coverage.additionalAssetsLoaded).map(([name, count]) => `${name}:${count}`).join(',')}`,
  '',
  '## Required probes',
  '',
  ...sourceTruth.coverage.requiredProbes.map((probe) => `- ${probe.name}: ${probe.status}${probe.spellId != null ? ` (spellId=${probe.spellId})` : ''}`),
  '',
  '## Presence semantics',
  '',
  '- ABSENT_FROM_SOURCE: aucune entrée de sort correspondante dans le périmètre source de classe.',
  '- PRESENT_FROM_SOURCE: donnée présente et sans sémantique non résolue détectée.',
  '- PRESENT_BUT_UNRESOLVED: donnée présente, conservée, mais au moins une sémantique reste non exécutée.',
  '',
  'IMPORTER != ACTIVER : ce catalogue n’est pas consommé automatiquement par le runtime combat.',
  ''
].join('\n');
await writeFile(new URL('spell-source-truth-coverage.md', outDir), sourceTruthMarkdown);

console.log(`Normalized ${catalog.spells.length} certified combat spells across ${catalog.breeds.length} classes.`);
console.log(`Variants: ${catalog.coverage.variantsCertified || 0} certified from ${rawVariantRecords} SpellVariantData records.`);
console.log(`Spell coverage report: ${new URL('spell-coverage-report.md', outDir).pathname}`);
console.log(`Source truth: ${sourceTruth.coverage.spellCount} spells, ${sourceTruth.coverage.effectInstanceCount} effect instances.`);
console.log(`Source truth coverage report: ${new URL('spell-source-truth-coverage.md', outDir).pathname}`);
