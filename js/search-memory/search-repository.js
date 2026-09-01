import { SearchMemoryRepository as PersistentSearchMemoryRepository } from './search-repository-core.js';

export {
  SEARCH_DB_NAME,
  SEARCH_DB_VERSION,
  SEARCH_STORE_NAME,
  SEARCH_RECORD_VERSION,
  DEFAULT_SEARCH_MEMORY_LIMIT,
  IndexedDbSearchStore,
  MemorySearchStore,
  serializeSearchOutput,
  hydrateSearchOutput,
  migrateSearchRecord
} from './search-repository-core.js';

class InertSearchStore {
  async get() { return null; }
  async getAll() { return []; }
  async put(record) { return record; }
  async delete() { return false; }
}

// Product searches instantiate the repository without options. That path is deliberately
// inert: every user click must reach a fresh Worker. Tests/tools that explicitly inject a
// store retain the repository implementation for isolated memory coverage.
export class SearchMemoryRepository extends PersistentSearchMemoryRepository {
  constructor(options) {
    super(options === undefined ? { store: new InertSearchStore() } : options);
  }
}
