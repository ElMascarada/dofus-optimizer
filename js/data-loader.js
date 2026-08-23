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

export async function loadDofusData(url = './data/normalized/dofus-data.json', fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== 'function') throw new Error('Fetch indisponible pour charger les données Dofus.');
  const response = await fetchImpl(url, { cache: 'no-cache' });
  if (!response?.ok) throw new Error(`Impossible de charger la base Dofus (${response?.status || 'erreur réseau'}).`);
  return validateDofusSnapshot(await response.json());
}
