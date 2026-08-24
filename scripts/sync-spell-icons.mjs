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

const spells = (catalog.spells || []).filter((spell) => Number(spell?.iconId || 0) > 0);
const iconIds = [...new Set(spells.map((spell) => Number(spell.iconId)))].sort((a, b) => a - b);

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

// The release has changed naming/layout several times (for example ids may be
// embedded in names instead of being the whole basename). Index every plausible
// numeric token, not only files named exactly `12345.png`.
const discovered = await collectPngFiles(fileURLToPath(extractedDir));
console.log(`Archive sample basenames: ${discovered.slice(0, 24).map((source) => basename(source)).join(', ')}`);

const sourceById = new Map();
for (const source of discovered) {
  const tokens = (basename(source).match(/\d+/g) || [])
    .map(Number)
    // Spell/icon/level ids are in the thousands. This deliberately ignores
    // dimensions such as 96 and 2x while remaining tolerant of suffixes.
    .filter((id) => Number.isInteger(id) && id >= 1000);
  for (const id of tokens) {
    if (!sourceById.has(id)) sourceById.set(id, source);
  }
}

function numericSpellId(spell) {
  const match = String(spell?.id || '').match(/(\d+)$/);
  return match ? Number(match[1]) : 0;
}

function candidateSourceIds(spell) {
  return [...new Set([
    Number(spell?.iconId || 0),
    Number(spell?.ankamaId || 0),
    numericSpellId(spell),
    Number(spell?.levelId || 0)
  ].filter((id) => Number.isInteger(id) && id > 0))];
}

const matchCounts = {
  iconId: spells.filter((spell) => sourceById.has(Number(spell.iconId || 0))).length,
  ankamaId: spells.filter((spell) => sourceById.has(Number(spell.ankamaId || 0))).length,
  normalizedId: spells.filter((spell) => sourceById.has(numericSpellId(spell))).length,
  levelId: spells.filter((spell) => sourceById.has(Number(spell.levelId || 0))).length
};
console.log(`Archive id matches: ${JSON.stringify(matchCounts)}`);

let copied = 0;
const copiedTargets = new Set();
const missing = [];
for (const spell of spells) {
  const targetId = Number(spell.iconId || 0);
  if (!(targetId > 0) || copiedTargets.has(targetId)) continue;

  const sourceId = candidateSourceIds(spell).find((id) => sourceById.has(id));
  const source = sourceId ? sourceById.get(sourceId) : null;
  if (!source) {
    missing.push({ iconId: targetId, ankamaId: Number(spell.ankamaId || 0), name: spell.name || spell.id });
    continue;
  }

  await copyFile(source, new URL(`${targetId}.png`, outputDir));
  copiedTargets.add(targetId);
  copied++;
}

const actual = (await readdir(outputDir)).filter((name) => name.endsWith('.png')).length;
await rm(tempDir, { recursive: true, force: true });

if (actual !== copied) throw new Error(`Spell icon sync mismatch: copied=${copied}, actual=${actual}`);
if (copied === 0) {
  const indexedSample = [...sourceById.keys()].slice(0, 20).join(', ');
  throw new Error(`Spell icon sync produced no files; archive contained ${discovered.length} PNG files; indexed sample ids: ${indexedSample}`);
}

console.log(`Spell icons: ${copied}/${iconIds.length} copied for Dofus ${version} (${discovered.length} PNG files discovered).`);
if (missing.length) {
  console.warn(`Missing spell icons (${missing.length}): ${missing.slice(0, 20).map((entry) => `${entry.iconId}/${entry.ankamaId} ${entry.name}`).join(' | ')}${missing.length > 20 ? '…' : ''}`);
}
