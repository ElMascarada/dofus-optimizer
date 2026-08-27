import './runtime-meta.js';
import {
  searchFingerprint,
  searchQuerySimilarity,
  searchVersionsAreCompatible
} from './search-query.js';

export const SEARCH_MEMORY_DB_NAME = 'dofus-optimizer-v2-search-memory';
export const SEARCH_MEMORY_DB_VERSION = 1;
export const SEARCH_MEMORY_STORE = 'optimizer-searches';
export const SEARCH_MEMORY_RECORD_VERSION = 1;

const memoryMeta = globalThis.DofusOptimizerRuntime?.searchMemory || {};
const DEFAULT_MAX_RECORDS = Math.max(10, Number(memoryMeta.maxRecords || 60));
const DEFAULT_NEARBY_RECORDS = Math.max(1, Number(memoryMeta.nearbyRecords || 4));
const DEFAULT_SEED_BUILDS = Math.max(1, Number(memoryMeta.maxSeedBuilds || 24));

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
    dbName = SEARCH_MEMORY_DB_NAME,
    version = SEARCH_MEMORY_DB_VERSION,
    storeName = SEARCH_MEMORY_STORE
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
        if (!store.indexNames.contains('classId')) store.createIndex('classId', 'classId', { unique: false });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        this.databasePromise = null;
        reject(request.error || new Error('Impossible d’ouvrir la mémoire de recherches IndexedDB.'));
      };
      request.onblocked = () => {
        this.databasePromise = null;
        reject(new Error('Mise à jour de la mémoire IndexedDB bloquée par un autre onglet.'));
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

  async get(fingerprint) {
    return copy(this.records.get(String(fingerprint)) || null);
  }

  async getAll() {
    return [...this.records.values()].map(copy);
  }

  async put(record) {
    this.records.set(String(record.fingerprint), copy(record));
    return copy(record);
  }

  async delete(fingerprint) {
    return this.records.delete(String(fingerprint));
  }
}

function serializeResult(result = {}) {
  const clone = copy(result) || {};
  const itemIds = (clone.items || []).map((item) => String(item?.id || '')).filter(Boolean);
  delete clone.items;
  return { ...clone, itemIds };
}

function hydrateResult(result = {}, itemById = new Map()) {
  const itemIds = (result?.itemIds || []).map(String).filter(Boolean);
  if (!itemIds.length) return null;
  const items = itemIds.map((id) => itemById.get(id));
  if (items.some((item) => !item)) return null;
  const clone = copy(result) || {};
  delete clone.itemIds;
  return { ...clone, items };
}

export function serializeSearchOutput(output = {}) {
  return {
    results: (output?.results || []).map(serializeResult),
    diagnostics: copy(output?.diagnostics || {})
  };
}

export function hydrateSearchOutput(snapshot = {}, { items = [] } = {}) {
  const itemById = new Map((items || []).map((item) => [String(item.id), item]));
  const hydrated = [];
  for (const result of snapshot?.results || []) {
    const value = hydrateResult(result, itemById);
    if (!value) return null;
    hydrated.push(value);
  }
  return {
    results: hydrated,
    diagnostics: copy(snapshot?.diagnostics || {})
  };
}

export function migrateSearchRecord(record = {}) {
  const version = Number(record?.schemaVersion || 0);
  if (version !== SEARCH_MEMORY_RECORD_VERSION) {
    throw new Error(`Version de mémoire Optimiseur non prise en charge: ${version}.`);
  }
  const fingerprint = String(record?.fingerprint || '');
  if (!fingerprint || !record?.query || !record?.output) throw new Error('Entrée de mémoire Optimiseur incomplète.');
  return {
    schemaVersion: SEARCH_MEMORY_RECORD_VERSION,
    fingerprint,
    classId: String(record.query.classId || ''),
    element: String(record.query.element || ''),
    turnMode: String(record.query.turnMode || ''),
    query: copy(record.query),
    output: copy(record.output),
    createdAt: record.createdAt || record.updatedAt || null,
    updatedAt: record.updatedAt || record.createdAt || null
  };
}

export function seedBuildsFromNearby(nearby = [], { limit = DEFAULT_SEED_BUILDS } = {}) {
  const ranked = [];
  for (const entry of nearby || []) {
    const record = entry?.record || entry;
    const similarity = Number(entry?.similarity || 0);
    for (const result of record?.output?.results || []) {
      const itemIds = (result?.itemIds || []).map(String).filter(Boolean);
      if (!itemIds.length) continue;
      ranked.push({
        itemIds,
        sourceFingerprint: String(record.fingerprint || ''),
        sourceScore: Number(result?.score || 0),
        similarity
      });
    }
  }
  ranked.sort((a, b) => b.similarity - a.similarity || b.sourceScore - a.sourceScore);
  const seen = new Set();
  const output = [];
  for (const seed of ranked) {
    const key = [...seed.itemIds].sort().join('|');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(seed);
    if (output.length >= Math.max(1, Number(limit || DEFAULT_SEED_BUILDS))) break;
  }
  return output;
}

export class SearchRepository {
  constructor({
    store = new IndexedDbSearchStore(),
    now = () => new Date().toISOString(),
    maxRecords = DEFAULT_MAX_RECORDS
  } = {}) {
    this.store = store;
    this.now = now;
    this.maxRecords = Math.max(10, Number(maxRecords || DEFAULT_MAX_RECORDS));
  }

  async save(query, output) {
    const fingerprint = searchFingerprint(query);
    const previous = await this.store.get(fingerprint);
    const timestamp = this.now();
    const record = {
      schemaVersion: SEARCH_MEMORY_RECORD_VERSION,
      fingerprint,
      classId: String(query?.classId || ''),
      element: String(query?.element || ''),
      turnMode: String(query?.turnMode || ''),
      query: copy(query),
      output: serializeSearchOutput(output),
      createdAt: previous?.createdAt || timestamp,
      updatedAt: timestamp
    };
    await this.store.put(record);
    await this.prune();
    return migrateSearchRecord(record);
  }

  async findExact(query, { items = [] } = {}) {
    const fingerprint = searchFingerprint(query);
    const raw = await this.store.get(fingerprint);
    if (!raw) return { hit: false, reason: 'miss', fingerprint, output: null, record: null };
    let record;
    try {
      record = migrateSearchRecord(raw);
    } catch {
      await this.store.delete(fingerprint).catch(() => {});
      return { hit: false, reason: 'invalid-record', fingerprint, output: null, record: null };
    }
    if (record.fingerprint !== fingerprint) {
      await this.store.delete(fingerprint).catch(() => {});
      return { hit: false, reason: 'invalid-record', fingerprint, output: null, record: null };
    }
    if (!searchVersionsAreCompatible(query, record.query)) {
      return { hit: false, reason: 'incompatible-version', fingerprint, output: null, record };
    }
    const output = hydrateSearchOutput(record.output, { items });
    if (!output) {
      await this.store.delete(fingerprint).catch(() => {});
      return { hit: false, reason: 'missing-item', fingerprint, output: null, record: null };
    }
    return { hit: true, reason: 'exact', fingerprint, output, record };
  }

  async findNearby(query, {
    limit = DEFAULT_NEARBY_RECORDS,
    minSimilarity = 0.5
  } = {}) {
    const exactFingerprint = searchFingerprint(query);
    const records = await this.store.getAll();
    const candidates = [];
    for (const raw of records) {
      let record;
      try { record = migrateSearchRecord(raw); } catch { continue; }
      if (record.fingerprint === exactFingerprint) continue;
      if (!searchVersionsAreCompatible(query, record.query)) continue;
      const similarity = searchQuerySimilarity(query, record.query);
      if (similarity < Number(minSimilarity || 0)) continue;
      candidates.push({ record, similarity });
    }
    candidates.sort((a, b) => b.similarity - a.similarity
      || String(b.record.updatedAt || '').localeCompare(String(a.record.updatedAt || '')));
    return candidates.slice(0, Math.max(1, Number(limit || DEFAULT_NEARBY_RECORDS)));
  }

  async prune() {
    const records = await this.store.getAll();
    if (records.length <= this.maxRecords) return 0;
    const ordered = records
      .map((record) => {
        try { return migrateSearchRecord(record); } catch { return null; }
      })
      .filter(Boolean)
      .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    const stale = ordered.slice(this.maxRecords);
    await Promise.all(stale.map((record) => this.store.delete(record.fingerprint)));
    return stale.length;
  }
}
