import {
  searchFingerprint,
  searchQueriesEqual,
  searchQueryDistance,
  searchVersionsCompatible
} from './search-query.js';

export const SEARCH_DB_NAME = 'dofus-optimizer-search-v2';
export const SEARCH_DB_VERSION = 1;
export const SEARCH_STORE_NAME = 'search-records';
export const SEARCH_RECORD_VERSION = 1;
export const DEFAULT_SEARCH_MEMORY_LIMIT = 80;

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

function transactionPromise(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve(true);
    transaction.onabort = () => reject(transaction.error || new Error('Transaction IndexedDB annulée.'));
    transaction.onerror = () => reject(transaction.error || new Error('Transaction IndexedDB en erreur.'));
  });
}

export class IndexedDbSearchStore {
  constructor({
    indexedDB = globalThis.indexedDB,
    dbName = SEARCH_DB_NAME,
    version = SEARCH_DB_VERSION,
    storeName = SEARCH_STORE_NAME
  } = {}) {
    this.indexedDB = indexedDB;
    this.dbName = dbName;
    this.version = version;
    this.storeName = storeName;
    this.databasePromise = null;
  }

  open() {
    if (this.databasePromise) return this.databasePromise;
    if (!this.indexedDB?.open) return Promise.reject(new Error('IndexedDB indisponible dans ce navigateur.'));
    this.databasePromise = new Promise((resolve, reject) => {
      const request = this.indexedDB.open(this.dbName, this.version);
      request.onupgradeneeded = () => {
        const database = request.result;
        let store;
        if (!database.objectStoreNames.contains(this.storeName)) {
          store = database.createObjectStore(this.storeName, { keyPath: 'fingerprint' });
        } else {
          store = request.transaction.objectStore(this.storeName);
        }
        if (!store.indexNames.contains('updatedAt')) store.createIndex('updatedAt', 'updatedAt', { unique: false });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        this.databasePromise = null;
        reject(request.error || new Error('Impossible d’ouvrir la mémoire de recherches IndexedDB.'));
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
    const completion = transactionPromise(transaction);
    const store = transaction.objectStore(this.storeName);
    try {
      const result = await action(store, transaction);
      await completion;
      return result;
    } catch (error) {
      try { transaction.abort(); } catch {}
      await completion.catch(() => {});
      throw error;
    }
  }

  async get(fingerprint) {
    return this.transact('readonly', async (store) => copy(await requestPromise(store.get(String(fingerprint)))));
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

  async delete(fingerprint) {
    return this.transact('readwrite', async (store) => {
      await requestPromise(store.delete(String(fingerprint)));
      return true;
    });
  }
}

export class MemorySearchStore {
  constructor(records = []) {
    this.records = new Map((records || []).map((record) => [String(record.fingerprint), copy(record)]));
  }
  async get(fingerprint) { return copy(this.records.get(String(fingerprint)) || null); }
  async getAll() { return [...this.records.values()].map(copy); }
  async put(record) {
    this.records.set(String(record.fingerprint), copy(record));
    return copy(record);
  }
  async delete(fingerprint) { return this.records.delete(String(fingerprint)); }
}

function resultSnapshot(result = {}) {
  const snapshot = copy(result) || {};
  const itemIds = (result.items || []).map((item) => String(item?.id || '')).filter(Boolean);
  delete snapshot.items;
  return { ...snapshot, itemIds };
}

export function serializeSearchOutput(output = {}) {
  return {
    results: (output.results || []).map(resultSnapshot),
    diagnostics: copy(output.diagnostics || {})
  };
}

export function hydrateSearchOutput(snapshot = {}, { items = [] } = {}) {
  const itemById = new Map((items || []).map((item) => [String(item.id), item]));
  const missingItemIds = new Set();
  const results = (snapshot.results || []).map((stored) => {
    const itemIds = (stored.itemIds || []).map(String);
    const hydratedItems = itemIds.map((id) => {
      const item = itemById.get(id);
      if (!item) missingItemIds.add(id);
      return item;
    }).filter(Boolean);
    const { itemIds: _itemIds, ...rest } = copy(stored);
    return { ...rest, items: hydratedItems };
  });
  if (missingItemIds.size) {
    return { compatible: false, output: null, missingItemIds: [...missingItemIds].sort() };
  }
  return {
    compatible: true,
    missingItemIds: [],
    output: { results, diagnostics: copy(snapshot.diagnostics || {}) }
  };
}

export function migrateSearchRecord(record = {}) {
  const schemaVersion = Number(record?.schemaVersion || 0);
  if (schemaVersion !== SEARCH_RECORD_VERSION) throw new Error(`Version de mémoire de recherche non prise en charge: ${schemaVersion}.`);
  if (!record?.fingerprint || !record?.query) throw new Error('Mémoire de recherche incomplète.');
  return {
    schemaVersion: SEARCH_RECORD_VERSION,
    fingerprint: String(record.fingerprint),
    query: copy(record.query),
    output: copy(record.output || { results: [], diagnostics: {} }),
    createdAt: record.createdAt || record.updatedAt || null,
    updatedAt: record.updatedAt || record.createdAt || null
  };
}

export class SearchMemoryRepository {
  constructor({
    store = new IndexedDbSearchStore(),
    now = () => new Date().toISOString(),
    maxRecords = DEFAULT_SEARCH_MEMORY_LIMIT
  } = {}) {
    this.store = store;
    this.now = now;
    this.maxRecords = Math.max(1, Number(maxRecords || DEFAULT_SEARCH_MEMORY_LIMIT));
  }

  async remember(query, output) {
    if (!query || !output || output?.diagnostics?.stoppedEarly) return null;
    if (!Array.isArray(output.results) || output.results.length === 0) return null;
    const fingerprint = searchFingerprint(query);
    const previous = await this.store.get(fingerprint);
    const timestamp = this.now();
    const record = {
      schemaVersion: SEARCH_RECORD_VERSION,
      fingerprint,
      query: copy(query),
      output: serializeSearchOutput(output),
      createdAt: previous?.createdAt || timestamp,
      updatedAt: timestamp
    };
    await this.store.put(record);
    await this.prune();
    return migrateSearchRecord(record);
  }

  async prune() {
    const records = (await this.store.getAll())
      .map((record) => {
        try { return migrateSearchRecord(record); } catch { return null; }
      })
      .filter(Boolean)
      .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    await Promise.all(records.slice(this.maxRecords).map((record) => this.store.delete(record.fingerprint)));
  }

  async recallExact(query, { items = [] } = {}) {
    const fingerprint = searchFingerprint(query);
    const raw = await this.store.get(fingerprint);
    if (!raw) return { hit: false, reason: 'miss', fingerprint, output: null };
    let record;
    try { record = migrateSearchRecord(raw); } catch { return { hit: false, reason: 'record-version', fingerprint, output: null }; }
    if (!searchQueriesEqual(record.query, query)) return { hit: false, reason: 'fingerprint-collision', fingerprint, output: null };
    if (!searchVersionsCompatible(record.query.versions, query.versions)) return { hit: false, reason: 'version', fingerprint, output: null };
    if (!Array.isArray(record.output?.results)) return { hit: false, reason: 'invalid-results', fingerprint, output: null };
    if (record.output.results.length === 0) return { hit: false, reason: 'empty-results', fingerprint, output: null };
    const hydrated = hydrateSearchOutput(record.output, { items });
    if (!hydrated.compatible) {
      return { hit: false, reason: 'missing-items', fingerprint, output: null, missingItemIds: hydrated.missingItemIds };
    }
    return { hit: true, reason: 'exact', fingerprint, output: hydrated.output, record };
  }

  async findNearby(query, { limit = 5, maxDistance = 0.35 } = {}) {
    const exactFingerprint = searchFingerprint(query);
    const records = await this.store.getAll();
    return records
      .map((raw) => {
        try {
          const record = migrateSearchRecord(raw);
          if (record.fingerprint === exactFingerprint) return null;
          const distance = searchQueryDistance(query, record.query);
          if (!Number.isFinite(distance) || distance > Number(maxDistance)) return null;
          return { record, distance };
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => a.distance - b.distance || String(b.record.updatedAt || '').localeCompare(String(a.record.updatedAt || '')))
      .slice(0, Math.max(0, Number(limit || 0)));
  }
}
