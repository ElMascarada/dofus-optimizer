import { mkdir, readFile, writeFile } from 'node:fs/promises';
import {
  buildCoverageReport,
  normalizeEquipmentItem,
  normalizeMount,
  normalizeSet,
  shouldIncludeEquipment
} from '../js/dofusdude-normalizer.js';

const rawDir = new URL('../data/raw/', import.meta.url);
const outDir = new URL('../data/normalized/', import.meta.url);
await mkdir(outDir, { recursive: true });

async function readJson(name) {
  return JSON.parse(await readFile(new URL(`${name}.json`, rawDir), 'utf8'));
}

function listFrom(payload, key = 'items') {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.[key])) return payload[key];
  return [];
}

function compactItem(item) {
  return {
    id: item.id,
    ankamaId: item.ankamaId,
    name: item.name,
    level: item.level,
    slot: item.slot,
    typeName: item.typeName,
    setId: item.setId,
    imageUrl: item.imageUrl,
    stats: item.stats,
    conditions: item.conditions,
    conditionStatus: item.conditionStatus,
    certified: item.certification.certified
  };
}

const [equipmentRaw, setsRaw, mountsRaw, elements, version] = await Promise.all([
  readJson('equipment'),
  readJson('sets'),
  readJson('mounts'),
  readJson('elements'),
  readJson('version')
]);

const allEquipment = listFrom(equipmentRaw).map((item) => normalizeEquipmentItem(item, elements));
const equipment = allEquipment.filter(shouldIncludeEquipment);
const mounts = listFrom(mountsRaw).map((mount) => normalizeMount(mount, elements));

const deduped = new Map();
for (const item of [...equipment, ...mounts]) deduped.set(item.id, item);
const allItems = [...deduped.values()];

const includedSetIds = new Set(allItems.map((item) => item.setId).filter(Boolean));
const sets = listFrom(setsRaw, 'sets')
  .map((set) => normalizeSet(set, elements))
  .filter((set) => includedSetIds.has(set.id));

const report = buildCoverageReport({ items: allItems, sets, elements, version });
const certifiedItems = allItems.filter((item) => item.certification.certified);
const certifiedSetIds = new Set(sets.filter((set) => set.certification.certified).map((set) => set.id));

const snapshot = {
  schemaVersion: 1,
  source: 'dofusdude',
  game: 'dofus3',
  language: 'fr',
  gameVersion: version,
  generatedAt: report.generatedAt,
  items: certifiedItems.map(compactItem),
  sets: sets.filter((set) => certifiedSetIds.has(set.id)).map((set) => ({
    id: set.id,
    ankamaId: set.ankamaId,
    name: set.name,
    bonuses: set.bonuses,
    equipmentIds: set.equipmentIds
  }))
};

await writeFile(new URL('dofus-data.json', outDir), JSON.stringify(snapshot));
await writeFile(new URL('coverage-report.json', outDir), JSON.stringify(report, null, 2));

const unknownEffects = Object.entries(report.items.unknownEffectNames).sort((a, b) => b[1] - a[1]);
const unknownConditions = Object.entries(report.items.unknownConditionNames).sort((a, b) => b[1] - a[1]);
const markdown = [
  '# Dofusdude normalization coverage',
  '',
  `- Generated: ${report.generatedAt}`,
  `- Game version: ${version?.version || 'unknown'} (${version?.release || 'unknown'})`,
  `- Included items: ${report.items.total}`,
  `- Certified items: ${report.items.certified} (${report.items.certifiedPct}%)`,
  `- Unknown slots: ${report.items.unknownSlot}`,
  `- Unmapped passive effects: ${report.items.unmappedEffects}`,
  `- Active effects intentionally excluded from stats: ${report.items.activeEffects}`,
  `- Meta effects: ${report.items.metaEffects}`,
  `- Items with unmapped conditions: ${report.items.unmappedConditions}`,
  `- Sets: ${report.sets.certified}/${report.sets.total} certified`,
  '',
  '## Slots',
  '',
  ...Object.entries(report.items.bySlot).sort().map(([slot, count]) => `- ${slot}: ${count}`),
  '',
  '## Unknown effect names',
  '',
  ...(unknownEffects.length ? unknownEffects.map(([name, count]) => `- ${name}: ${count}`) : ['- none']),
  '',
  '## Unknown condition names',
  '',
  ...(unknownConditions.length ? unknownConditions.map(([name, count]) => `- ${name}: ${count}`) : ['- none']),
  ''
].join('\n');
await writeFile(new URL('coverage-report.md', outDir), markdown);

console.log(`Normalized ${allItems.length} included items; ${certifiedItems.length} certified (${report.items.certifiedPct}%).`);
console.log(`Certified sets: ${report.sets.certified}/${report.sets.total}.`);
console.log(`Coverage report: ${new URL('coverage-report.md', outDir).pathname}`);
