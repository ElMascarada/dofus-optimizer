import {
  migrateWorkshopBuildSnapshot,
  rehydrateWorkshopBuild,
  serializeWorkshopBuild
} from './build-serialization.js';

export const WORKSHOP_DB_NAME = 'dofus-optimizer-v2';
export const WORKSHOP_DB_VERSION = 1;
export const WORKSHOP_BUILD_STORE = 'workshop-builds';
export const WORKSHOP_BUILD_RECORD_VERSION = 1;
export const WORKSHOP_DRAFT_ID = '__workshop-draft__';

function copy(value) {
  if (value == null) return value;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function requestPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB request failed.'));
  });
}

export class IndexedDbBuildStore {
  constructor({
    indexedDB = globalThis.indexedDB,
    dbName = WORKSHOP_DB_NAME,
    version = WORKSHOP_DB_VERSION,
    storeName = WORKSHOP_BUILD_STORE
  } = {}) {
    this.indexedDB = indexedDB;
    this.dbName = dbName;
    this.version = version;
    this.storeName = storeName;
    this.databasePromise = null;
  }

  open() {
    if (this.databasePromise) return this.databasePromise;
    if (!this.indexedDB?.open) {
      return Promise.reject(new Error('IndexedDB indisponible dans ce navigateur.'));
    }
    this.databasePromise = new Promise((resolve, reject) => {
      const request = this.indexedDB.open(this.dbName, this.version);
      request.onupgradeneeded = () => {
        const database = request.result;
        let store;
        if (!database.objectStoreNames.contains(this.storeName)) {
          store = database.createObjectStore(this.storeName, { keyPath: 'id' });
        } else {
          store = request.transaction.objectStore(this.storeName);
        }
        if (!store.indexNames.contains('kind')) store.createIndex('kind', 'kind', { unique: false });
        if (!store.indexNames.contains('updatedAt')) store.createIndex('updatedAt', 'updatedAt', { unique: false });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        this.databasePromise = null;
        reject(request.error || new Error('Impossible d’ouvrir IndexedDB.'));
      };
      request.onblocked = () => {
        this.databasePromise = null;
        reject(new Error('Mise à jour IndexedDB bloquée par un autre onglet.'));
      };
    });
    return this.databasePromise;
  }

  async transact(mode, action) {
    const database = await this.open();
    const transaction = database.transaction(this.storeName, mode);
    const store = transaction.objectStore(this.storeName);
    return action(store, transaction);
  }

  async get(id) {
    return this.transact('readonly', async (store) => copy(await requestPromise(store.get(String(id)))));
  }

  async getAll() {
    return this.transact('readonly', async (store) => copy(await requestPromise(store.getAll())) || []);
  }

  async put(record) {
    return this.transact('readwrite', async (store) => {
      await requestPromise(store.put(copy(record)));
      return copy(record);
    });
  }

  async delete(id) {
    return this.transact('readwrite', async (store) => {
      await requestPromise(store.delete(String(id)));
      return true;
    });
  }
}

export class MemoryBuildStore {
  constructor(records = []) {
    this.records = new Map((records || []).map((record) => [String(record.id), copy(record)]));
  }

  async get(id) {
    return copy(this.records.get(String(id)) || null);
  }

  async getAll() {
    return [...this.records.values()].map(copy);
  }

  async put(record) {
    this.records.set(String(record.id), copy(record));
    return copy(record);
  }

  async delete(id) {
    return this.records.delete(String(id));
  }
}

function defaultIdFactory() {
  if (globalThis.crypto?.randomUUID) return `build-${globalThis.crypto.randomUUID()}`;
  return `build-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function cleanName(value, fallback = 'Stuff sans nom') {
  const normalized = String(value || '').trim().replace(/\s+/g, ' ');
  return normalized.slice(0, 80) || fallback;
}

export function migrateBuildRecord(record = {}) {
  const version = Number(record?.schemaVersion || 0);
  if (version > WORKSHOP_BUILD_RECORD_VERSION) {
    throw new Error(`Version de sauvegarde Atelier non prise en charge: ${version}.`);
  }
  const id = String(record.id || '');
  if (!id) throw new Error('Sauvegarde Atelier sans identifiant.');
  const snapshot = migrateWorkshopBuildSnapshot(record.snapshot || record.build || {});
  return {
    schemaVersion: WORKSHOP_BUILD_RECORD_VERSION,
    id,
    kind: id === WORKSHOP_DRAFT_ID || record.kind === 'draft' ? 'draft' : 'saved',
    name: cleanName(record.name, id === WORKSHOP_DRAFT_ID ? 'Brouillon' : 'Stuff sans nom'),
    snapshot,
    createdAt: record.createdAt || record.updatedAt || null,
    updatedAt: record.updatedAt || record.createdAt || null
  };
}

export class BuildRepository {
  constructor({
    store = new IndexedDbBuildStore(),
    now = () => new Date().toISOString(),
    idFactory = defaultIdFactory
  } = {}) {
    this.store = store;
    this.now = now;
    this.idFactory = idFactory;
  }

  async list() {
    const records = await this.store.getAll();
    return records
      .map(migrateBuildRecord)
      .filter((record) => record.kind === 'saved')
      .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')) || a.name.localeCompare(b.name, 'fr'));
  }

  async get(id) {
    const record = await this.store.get(String(id));
    return record ? migrateBuildRecord(record) : null;
  }

  async save(build, { id = null, name = '', dataVersion = null } = {}) {
    const recordId = id ? String(id) : String(this.idFactory());
    if (recordId === WORKSHOP_DRAFT_ID) throw new Error('L’identifiant du brouillon est réservé.');
    const previous = await this.get(recordId);
    const timestamp = this.now();
    const record = {
      schemaVersion: WORKSHOP_BUILD_RECORD_VERSION,
      id: recordId,
      kind: 'saved',
      name: cleanName(name, previous?.name || 'Stuff sans nom'),
      snapshot: serializeWorkshopBuild(build, { dataVersion }),
      createdAt: previous?.createdAt || timestamp,
      updatedAt: timestamp
    };
    await this.store.put(record);
    return migrateBuildRecord(record);
  }

  async rename(id, name) {
    const current = await this.get(id);
    if (!current || current.kind !== 'saved') return null;
    const next = { ...current, name: cleanName(name, current.name), updatedAt: this.now() };
    await this.store.put(next);
    return migrateBuildRecord(next);
  }

  async duplicate(id, { name = null } = {}) {
    const current = await this.get(id);
    if (!current || current.kind !== 'saved') return null;
    const timestamp = this.now();
    const next = {
      ...current,
      id: String(this.idFactory()),
      name: cleanName(name, `${current.name} — copie`),
      createdAt: timestamp,
      updatedAt: timestamp
    };
    await this.store.put(next);
    return migrateBuildRecord(next);
  }

  async delete(id) {
    if (String(id) === WORKSHOP_DRAFT_ID) return false;
    return this.store.delete(String(id));
  }

  async saveDraft(build, { dataVersion = null } = {}) {
    const timestamp = this.now();
    const previous = await this.get(WORKSHOP_DRAFT_ID);
    const record = {
      schemaVersion: WORKSHOP_BUILD_RECORD_VERSION,
      id: WORKSHOP_DRAFT_ID,
      kind: 'draft',
      name: 'Brouillon',
      snapshot: serializeWorkshopBuild(build, { dataVersion }),
      createdAt: previous?.createdAt || timestamp,
      updatedAt: timestamp
    };
    await this.store.put(record);
    return migrateBuildRecord(record);
  }

  async loadDraft() {
    const record = await this.get(WORKSHOP_DRAFT_ID);
    return record?.kind === 'draft' ? record : null;
  }

  async clearDraft() {
    return this.store.delete(WORKSHOP_DRAFT_ID);
  }

  hydrate(record, { items = [], currentDataVersion = null } = {}) {
    if (!record) return null;
    const migrated = migrateBuildRecord(record);
    const rehydration = rehydrateWorkshopBuild(migrated.snapshot, { items });
    return {
      ...migrated,
      ...rehydration,
      staleDataVersion: Boolean(
        migrated.snapshot.dataVersion
        && currentDataVersion
        && String(migrated.snapshot.dataVersion) !== String(currentDataVersion)
      )
    };
  }
}
