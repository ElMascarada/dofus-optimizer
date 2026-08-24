import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

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
const tar = spawnSync('tar', ['-xzf', archivePath.pathname, '-C', extractedDir.pathname], { encoding: 'utf8' });
if (tar.status !== 0) throw new Error(`Spell icon archive extraction failed: ${tar.stderr || tar.stdout}`);

const sourceDir = new URL('data/img/spell/2x/', extractedDir);
let copied = 0;
const missing = [];
for (const iconId of iconIds) {
  try {
    await copyFile(new URL(`${iconId}.png`, sourceDir), new URL(`${iconId}.png`, outputDir));
    copied++;
  } catch {
    missing.push(iconId);
  }
}

const actual = (await readdir(outputDir)).filter((name) => name.endsWith('.png')).length;
await rm(tempDir, { recursive: true, force: true });

if (actual !== copied) throw new Error(`Spell icon sync mismatch: copied=${copied}, actual=${actual}`);
if (copied === 0) throw new Error('Spell icon sync produced no files');

console.log(`Spell icons: ${copied}/${iconIds.length} copied for Dofus ${version}.`);
if (missing.length) console.warn(`Missing spell icons (${missing.length}): ${missing.slice(0, 20).join(', ')}${missing.length > 20 ? '…' : ''}`);
