import { mkdir, readFile, writeFile } from 'node:fs/promises';

const rawDir = new URL('../data/raw/', import.meta.url);
await mkdir(rawDir, { recursive: true });

const versionPayload = JSON.parse(await readFile(new URL('version.json', rawDir), 'utf8'));
const version = versionPayload?.version;
if (!version) throw new Error('Dofusdude version metadata did not expose a version tag.');

async function getJson(url) {
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} — ${url}`);
  return response.json();
}

const releaseBase = `https://github.com/dofusdude/dofus3-main/releases/download/${encodeURIComponent(version)}`;
for (const name of ['spells', 'spell_levels', 'breeds', 'effects', 'fr']) {
  console.log(`Fetching spell source ${name} for Dofus ${version}…`);
  const payload = await getJson(`${releaseBase}/${name}.json`);
  await writeFile(new URL(`${name}.json`, rawDir), JSON.stringify(payload));
}

console.log(`Spell source snapshot ${version} complete.`);
