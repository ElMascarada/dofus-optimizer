import { readFile, writeFile } from 'node:fs/promises';
import { applyCuratedItemRules, applyCuratedSpellRules } from '../js/curated-runtime-rules.js';

const normalizedDir = new URL('../data/normalized/', import.meta.url);

async function patchJson(name, mapper) {
  const url = new URL(name, normalizedDir);
  const payload = JSON.parse(await readFile(url, 'utf8'));
  const patched = mapper(payload);
  await writeFile(url, JSON.stringify(patched));
}

await patchJson('dofus-data.json', (snapshot) => ({
  ...snapshot,
  items: (snapshot.items || []).map(applyCuratedItemRules)
}));

await patchJson('spell-data.json', (snapshot) => ({
  ...snapshot,
  spells: (snapshot.spells || []).map(applyCuratedSpellRules)
}));

console.log('Applied curated snapshot rules: Concentration normal-target line and Ganymede turn cycle.');
