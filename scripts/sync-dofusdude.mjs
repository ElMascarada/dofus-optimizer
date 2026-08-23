import { mkdir, writeFile } from 'node:fs/promises';

const BASE = 'https://api.dofusdu.de/dofus3/v1/fr';
const META = 'https://api.dofusdu.de/dofus3/v1/meta';
const outDir = new URL('../data/raw/', import.meta.url);
await mkdir(outDir, { recursive: true });

async function getJson(url) {
  const response = await fetch(url, { headers: { Accept: 'application/json', 'Accept-Encoding': 'gzip' } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} — ${url}`);
  return response.json();
}

const sources = {
  equipment: `${BASE}/items/equipment/all`,
  sets: `${BASE}/sets/all`,
  mounts: `${BASE}/mounts/all`,
  elements: `${META}/elements`,
  version: `${META}/version`
};

for (const [name, url] of Object.entries(sources)) {
  console.log(`Fetching ${name}…`);
  const payload = await getJson(url);
  await writeFile(new URL(`${name}.json`, outDir), JSON.stringify(payload));
  console.log(`Saved ${name}.json`);
}

console.log('Raw Dofusdude snapshot complete. Normalization/coverage is intentionally a separate step.');
