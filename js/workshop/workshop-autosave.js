export function createWorkshopAutosave(repository, {
  dataVersion = null,
  delayMs = 250,
  schedule = (callback, delay) => setTimeout(callback, delay),
  cancel = (handle) => clearTimeout(handle),
  onSaved = () => {},
  onError = () => {}
} = {}) {
  let pendingBuild = null;
  let timer = null;
  let inFlight = Promise.resolve();

  async function persist(build) {
    if (!build) return null;
    try {
      const record = await repository.saveDraft(build, { dataVersion });
      onSaved(record);
      return record;
    } catch (error) {
      onError(error);
      return null;
    }
  }

  function enqueuePersist(build) {
    inFlight = inFlight.then(() => persist(build));
    return inFlight;
  }

  return {
    queue(build) {
      pendingBuild = build;
      if (timer != null) cancel(timer);
      timer = schedule(() => {
        timer = null;
        const next = pendingBuild;
        pendingBuild = null;
        enqueuePersist(next);
      }, delayMs);
    },
    async flush(build = null) {
      if (timer != null) {
        cancel(timer);
        timer = null;
      }
      const next = build || pendingBuild;
      pendingBuild = null;
      if (next) enqueuePersist(next);
      await inFlight;
      return true;
    },
    async restore({ items = [], currentDataVersion = dataVersion } = {}) {
      const record = await repository.loadDraft();
      return record ? repository.hydrate(record, { items, currentDataVersion }) : null;
    },
    dispose() {
      if (timer != null) cancel(timer);
      timer = null;
      pendingBuild = null;
    }
  };
}
