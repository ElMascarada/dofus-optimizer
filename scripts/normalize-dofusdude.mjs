import { mkdir, readFile, writeFile } from 'node:fs/promises';
import {
  buildCoverageReport,
  shouldIncludeEquipment
} from '../js/dofusdude-normalizer.js';
import { normalizeSourceEquipment, normalizeSourceMount, normalizeSourceSet } from '../js/dofus-source-rules.js';
import {
  collectUnknownSlotTypes,
  equipmentForCoverage,
  isSolverSafeSet,
  selectSnapshotItems,
  sourceGeneratedAt
} from '../js/data-certification.js';

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

function effectNamesByStatus(items, status) {
  const counts = {};
  for (const item of items) {
    for (const effect of item.source?.effects || []) {
      if (effect.status !== status) continue;
      const key = effect.name || effect.formatted || 'UNKNOWN';
      counts[key] = (counts[key] || 0) + 1;
    }
  }
  return counts;
}

function bySlot(items) {
  const counts = {};
  for (const item of items) counts[item.slot || 'unknown'] = (counts[item.slot || 'unknown'] || 0) + 1;
  return counts;
}

function compactItem(item) {
  return {
    id: item.id,
    ankamaId: item.ankamaId,
    name: item.name,
    level: item.level,
    slot: item.slot,
    typeName: item.typeName,
    slotSubtype: item.slotSubtype || null,
    setId: item.setId,
    imageUrl: item.imageUrl,
    stats: item.stats,
    passives: item.passives || [],
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

const allEquipment = listFrom(equipmentRaw).map((item) => normalizeSourceEquipment(item, elements));
const equipment = allEquipment.filter(shouldIncludeEquipment);
const coverageEquipment = equipmentForCoverage(allEquipment);
const mounts = listFrom(mountsRaw).map((mount) => normalizeSourceMount(mount, elements));

const deduped = new Map();
for (const item of [...equipment, ...mounts]) deduped.set(item.id, item);
const allItems = [...deduped.values()];

const includedSetIds = new Set(allItems.map((item) => item.setId).filter(Boolean));
const sets = listFrom(setsRaw, 'sets')
  .map((set) => normalizeSourceSet(set, elements))
  .filter((set) => includedSetIds.has(set.id));

const reportItems = [...coverageEquipment, ...mounts];
const report = buildCoverageReport({ items: reportItems, sets, elements, version });
report.generatedAt = sourceGeneratedAt(version, report.generatedAt);
report.items.unknownSlotTypes = collectUnknownSlotTypes(reportItems);
const solverSafeSets = sets.filter(isSolverSafeSet);
const certifiedItems = selectSnapshotItems(allItems, sets);
report.items.snapshotCertified = certifiedItems.length;
report.items.excludedByUncertifiedSet = allItems.filter((item) => item.certification.certified && item.setId && !certifiedItems.includes(item)).length;
report.sets.certified = solverSafeSets.length;
report.sets.uncertified = sets.length - solverSafeSets.length;
report.items.ignoredEffects = reportItems.reduce((sum, item) => sum + (item.source?.ignoredEffects?.length || 0), 0) + sets.reduce((sum, set) => sum + (set.source?.ignoredEffects || 0), 0);
report.items.activeEffectNames = effectNamesByStatus(reportItems, 'active');
report.items.metaEffectNames = effectNamesByStatus(reportItems, 'meta');
report.items.temporalPending = reportItems.filter((item) => item.certification?.temporalEffectsPending).map((item) => ({ name: item.name, typeName: item.typeName, slot: item.slot }));
report.items.recognizedPassives = reportItems.filter((item) => item.passives?.length).map((item) => ({ name: item.name, ankamaId: item.ankamaId, passives: item.passives.map((passive) => passive.id) }));
report.items.snapshotBySlot = bySlot(certifiedItems);
report.sets.uncertifiedNames = sets.filter((set) => !isSolverSafeSet(set)).map((set) => set.name);

const snapshot = {
  schemaVersion: 1,
  source: 'dofusdude',
  game: 'dofus3',
  language: 'fr',
  gameVersion: version,
  generatedAt: report.generatedAt,
  items: certifiedItems.map(compactItem),
  sets: solverSafeSets.map((set) => ({
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
const unknownSlots = Object.entries(report.items.unknownSlotTypes).sort((a, b) => b[1] - a[1]);
const metaEffects = Object.entries(report.items.metaEffectNames).sort((a, b) => b[1] - a[1]);
const activeEffects = Object.entries(report.items.activeEffectNames).sort((a, b) => b[1] - a[1]);
const markdown = [
  '# Dofusdude normalization coverage',
  '',
  `- Generated: ${report.generatedAt}`,
  `- Game version: ${version?.version || 'unknown'} (${version?.release || 'unknown'})`,
  `- Included items: ${report.items.total}`,
  `- Self-certified items in coverage scope: ${report.items.certified} (${report.items.certifiedPct}%)`,
  `- Snapshot-certified items: ${report.items.snapshotCertified}`,
  `- Excluded because linked set is not certified: ${report.items.excludedByUncertifiedSet}`,
  `- Unknown slots: ${report.items.unknownSlot}`,
  `- Unmapped passive effects: ${report.items.unmappedEffects}`,
  `- Active effects intentionally excluded from stats: ${report.items.activeEffects}`,
  `- Meta effects: ${report.items.metaEffects}`,
  `- Explicitly ignored non-combat metadata: ${report.items.ignoredEffects || 0}`,
  `- Items with unmapped conditions: ${report.items.unmappedConditions}`,
  `- Sets: ${report.sets.certified}/${report.sets.total} certified`,
  '',
  '## Slots',
  '',
  ...Object.entries(report.items.bySlot).sort().map(([slot, count]) => `- ${slot}: ${count}`),
  '',
  '## Unknown slot types',
  '',
  ...(unknownSlots.length ? unknownSlots.map(([name, count]) => `- ${name}: ${count}`) : ['- none']),
  '',
  '## Unknown effect names',
  '',
  ...(unknownEffects.length ? unknownEffects.map(([name, count]) => `- ${name}: ${count}`) : ['- none']),
  '',
  '## Unknown condition names',
  '',
  ...(unknownConditions.length ? unknownConditions.map(([name, count]) => `- ${name}: ${count}`) : ['- none']),
  '',
  '## Meta effect names',
  '',
  ...(metaEffects.length ? metaEffects.map(([name, count]) => `- ${name}: ${count}`) : ['- none']),
  '',
  '## Active effect names',
  '',
  ...(activeEffects.length ? activeEffects.map(([name, count]) => `- ${name}: ${count}`) : ['- none']),
  '',
  '## Recognized temporal passives',
  '',
  ...(report.items.recognizedPassives.length ? report.items.recognizedPassives.map((item) => `- ${item.name} (#${item.ankamaId}): ${item.passives.join(', ')}`) : ['- none']),
  '',
  '## Temporal items pending',
  '',
  ...(report.items.temporalPending.length ? report.items.temporalPending.map((item) => `- ${item.name} (${item.typeName || item.slot || 'unknown'})`) : ['- none']),
  '',
  '## Uncertified sets',
  '',
  ...(report.sets.uncertifiedNames.length ? report.sets.uncertifiedNames.map((name) => `- ${name}`) : ['- none']),
  ''
].join('\n');
await writeFile(new URL('coverage-report.md', outDir), markdown);

console.log(`Normalized ${allItems.length} included items; ${certifiedItems.length} certified (${report.items.certifiedPct}%).`);
console.log(`Certified sets: ${report.sets.certified}/${report.sets.total}.`);
console.log(`Coverage report: ${new URL('coverage-report.md', outDir).pathname}`);
