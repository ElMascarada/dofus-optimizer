import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const catalogPath = new URL('data/normalized/spell-data.json', root);
const outputDir = new URL('assets/spells/', root);
const tempDir = new URL('.tmp-spell-icons/', root);
const archivePath = new URL('spell_images_96.tar.gz', tempDir);

const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
const version = String(catalog?.gameVersion?.version || '').trim();
if (!version) throw new Error('Cannot sync spell icons: missing game version in spell-data.json');

const iconIds = [...new Set((catalog.spells || [])
  .map((spell) => Number(spell?.iconId || 0))
  .filter((id) => Number.isInteger(id) && id > 0))]
  .sort((a, b) => a - b);

await rm(tempDir, { recursive: true, force: true });
await mkdir(tempDir, { recursive: true });
await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });

const releaseUrl = `https://github.com/dofusdude/dofus3-main/releases/download/${encodeURIComponent(version)}/spell_images_96.tar.gz`;
const response = await fetch(releaseUrl, { redirect: 'follow' });
if (!response.ok) throw new Error(`Spell icon archive download failed (${response.status}) for ${releaseUrl}`);
await writeFile(archivePath, Buffer.from(await response.arrayBuffer()));

const extractedDir = new URL('extracted/', tempDir);
await mkdir(extractedDir, { recursive: true });
const tar = spawnSync('tar', ['-xzf', fileURLToPath(archivePath), '-C', fileURLToPath(extractedDir)], { encoding: 'utf8' });
if (tar.status !== 0) throw new Error(`Spell icon archive extraction failed: ${tar.stderr || tar.stdout}`);

async function collectPngFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectPngFiles(fullPath));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.png')) files.push(fullPath);
  }
  return files;
}

// Dofusdude has changed the internal archive layout between releases. Discover
// the numeric spell icon files recursively instead of hard-coding one folder.
const discovered = await collectPngFiles(fileURLToPath(extractedDir));
const sourceById = new Map();
for (const source of discovered) {
  const match = basename(source).match(/^(\d+)\.png$/i);
  if (!match) continue;
  const id = Number(match[1]);
  if (!sourceById.has(id)) sourceById.set(id, source);
}

let copied = 0;
const missing = [];
for (const iconId of iconIds) {
  const source = sourceById.get(iconId);
  if (!source) {
    missing.push(iconId);
    continue;
  }
  await copyFile(source, new URL(`${iconId}.png`, outputDir));
  copied++;
}

const actual = (await readdir(outputDir)).filter((name) => name.endsWith('.png')).length;
await rm(tempDir, { recursive: true, force: true });

if (actual !== copied) throw new Error(`Spell icon sync mismatch: copied=${copied}, actual=${actual}`);
if (copied === 0) throw new Error(`Spell icon sync produced no files; archive contained ${discovered.length} PNG files`);

console.log(`Spell icons: ${copied}/${iconIds.length} copied for Dofus ${version} (${discovered.length} PNG files discovered).`);
if (missing.length) console.warn(`Missing spell icons (${missing.length}): ${missing.slice(0, 20).join(', ')}${missing.length > 20 ? '…' : ''}`);
