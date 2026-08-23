export function validateDofusSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') throw new Error('Snapshot Dofus invalide.');
  if (Number(snapshot.schemaVersion) !== 1) throw new Error(`Version de snapshot non prise en charge: ${snapshot.schemaVersion ?? 'absente'}.`);
  if (!Array.isArray(snapshot.items) || !Array.isArray(snapshot.sets)) throw new Error('Le snapshot doit contenir items et sets.');

  const items = snapshot.items.filter((item) => item?.certified === true && item?.id && item?.slot);
  const sets = snapshot.sets.filter((set) => set?.id && set?.bonuses && typeof set.bonuses === 'object');
  if (!items.length) throw new Error('Le snapshot certifié ne contient aucun équipement.');

  return {
    schemaVersion: 1,
    source: snapshot.source || 'unknown',
    game: snapshot.game || 'dofus3',
    language: snapshot.language || 'fr',
    gameVersion: snapshot.gameVersion || {},
    generatedAt: snapshot.generatedAt || null,
    items,
    sets
  };
}

export function validateSpellSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') throw new Error('Snapshot de sorts Dofus invalide.');
  if (Number(snapshot.schemaVersion) !== 1) throw new Error(`Version de snapshot de sorts non prise en charge: ${snapshot.schemaVersion ?? 'absente'}.`);
  if (!Array.isArray(snapshot.breeds) || !Array.isArray(snapshot.spells)) throw new Error('Le snapshot de sorts doit contenir breeds et spells.');

  const spells = snapshot.spells.filter((spell) =>
    spell?.certified === true
    && spell?.id
    && spell?.breedId
    && Array.isArray(spell?.hits)
    && spell.hits.length > 0
    && Number.isFinite(Number(spell.apCost))
  );
  const spellIds = new Set(spells.map((spell) => spell.id));
  const breeds = snapshot.breeds
    .filter((breed) => breed?.id && breed?.name)
    .map((breed) => ({
      ...breed,
      spellIds: (breed.spellIds || []).filter((id) => spellIds.has(id))
    }))
    .filter((breed) => breed.spellIds.length > 0);

  if (!spells.length || !breeds.length) throw new Error('Le snapshot certifié ne contient aucun sort offensif utilisable.');

  return {
    schemaVersion: 1,
    source: snapshot.source || 'unknown',
    game: snapshot.game || 'dofus3',
    language: snapshot.language || 'fr',
    gameVersion: snapshot.gameVersion || {},
    generatedAt: snapshot.generatedAt || null,
    characterLevel: Number(snapshot.characterLevel || 200),
    model: snapshot.model || 'unknown',
    coverage: snapshot.coverage || {},
    breeds,
    spells
  };
}

async function loadJson(url, fetchImpl, label) {
  if (typeof fetchImpl !== 'function') throw new Error(`Fetch indisponible pour charger ${label}.`);
  const response = await fetchImpl(url, { cache: 'no-cache' });
  if (!response?.ok) throw new Error(`Impossible de charger ${label} (${response?.status || 'erreur réseau'}).`);
  return response.json();
}

export async function loadDofusData(url = './data/normalized/dofus-data.json', fetchImpl = globalThis.fetch) {
  return validateDofusSnapshot(await loadJson(url, fetchImpl, 'la base Dofus'));
}

export async function loadSpellData(url = './data/normalized/spell-data.json', fetchImpl = globalThis.fetch) {
  return validateSpellSnapshot(await loadJson(url, fetchImpl, 'le catalogue de sorts'));
}
