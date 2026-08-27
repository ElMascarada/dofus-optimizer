import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { validateDofusSnapshot, validateSpellSnapshot } from '../js/data-loader.js';
import { WORKSHOP_SLOTS, createWorkshopBuild, equipWorkshopItem } from '../js/workshop/workshop-build.js';
import { evaluateWorkshopBuild } from '../js/workshop/workshop-evaluator.js';

const rawItems = JSON.parse(await readFile(new URL('../data/normalized/dofus-data.json', import.meta.url), 'utf8'));
const rawSpells = JSON.parse(await readFile(new URL('../data/normalized/spell-data.json', import.meta.url), 'utf8'));
const dataset = validateDofusSnapshot(rawItems);
const spellData = validateSpellSnapshot(rawSpells);
const classId = spellData.breeds.find((breed) => breed.id === 'breed-8')?.id || spellData.breeds[0]?.id;

function simpleItemCandidates(slot) {
  return dataset.items.filter((item) => item.slot === slot
    && !item.conditions
    && !(item.passives || []).length
    && item.slotSubtype !== 'prysmaradite');
}

let build = createWorkshopBuild({ classId });
const used = new Set();
for (const descriptor of WORKSHOP_SLOTS) {
  const candidate = simpleItemCandidates(descriptor.slot).find((item) => !used.has(item.id));
  if (!candidate) throw new Error(`Aucun item simple pour ${descriptor.key}`);
  const update = equipWorkshopItem(build, descriptor.key, candidate);
  if (!update.accepted) throw new Error(`Impossible d'équiper ${candidate.name} sur ${descriptor.key}: ${update.reason}`);
  used.add(candidate.id);
  build = update.build;
}

const replacement = simpleItemCandidates('hat').find((item) => item.id !== build.equipmentBySlot.hat.id);
if (!replacement) throw new Error('Aucune coiffe de remplacement pour le benchmark Atelier.');
const replaced = equipWorkshopItem(build, 'hat', replacement);
if (!replaced.accepted) throw new Error(`Coiffe de remplacement invalide: ${replaced.reason}`);

for (let index = 0; index < 5; index++) {
  evaluateWorkshopBuild({ build: index % 2 ? build : replaced.build, dataset, spellData });
}

const samples = [];
for (let index = 0; index < 30; index++) {
  const current = index % 2 ? build : replaced.build;
  const start = performance.now();
  const output = evaluateWorkshopBuild({ build: current, dataset, spellData });
  const elapsed = performance.now() - start;
  if (!output.valid) throw new Error(`Build benchmark invalide: ${output.reason}`);
  samples.push(elapsed);
}

samples.sort((a, b) => a - b);
const median = samples[Math.floor(samples.length / 2)];
const p95 = samples[Math.min(samples.length - 1, Math.ceil(samples.length * 0.95) - 1)];
const maximum = samples.at(-1);
console.log(`WORKSHOP_RECALC median=${median.toFixed(3)}ms p95=${p95.toFixed(3)}ms max=${maximum.toFixed(3)}ms samples=${samples.length} spells=${evaluateWorkshopBuild({ build, dataset, spellData }).spells.length}`);

if (p95 > 100) {
  throw new Error(`Régression Atelier: p95 ${p95.toFixed(3)}ms > 100ms`);
}
