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

// This runs at build/sync time, never in the browser. We intentionally fetch all equipment
// because level-200 builds can still use lower-level Dofus, trophies and companions.
// The normalization step then keeps level-200 gear plus all Dofus/trophies/companions.
const equipmentFields = 'effects,conditions,is_weapon,parent_set';
const sources = {
  equipment: `${BASE}/items/equipment?page[size]=-1&fields[item]=${equipmentFields}`,
  sets: `${BASE}/sets?page[size]=-1&fields[set]=effects,equipment_ids`,
  mounts: `${BASE}/mounts?page[size]=-1&fields[mount]=effects`,
  elements: `${META}/elements`,
  version: `${META}/version`
};

for (const [name, url] of Object.entries(sources)) {
  console.log(`Fetching ${name}…`);
  const payload = await getJson(url);
  await writeFile(new URL(`${name}.json`, outDir), JSON.stringify(payload));
  console.log(`Saved ${name}.json`);
}

console.log('Raw Dofusdude snapshot complete. Run npm run normalize:data next.');
