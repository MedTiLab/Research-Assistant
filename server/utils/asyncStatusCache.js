export function createAsyncStatusCache(loader, { ttlMs = 5_000, now = Date.now } = {}) {
  let cached = null;
  let inFlight = null;

  return {
    async get() {
      const currentTime = now();
      if (cached && currentTime - cached.recordedAt < ttlMs) {
        return cached.value;
      }
      if (inFlight) {
        return inFlight;
      }

      inFlight = Promise.resolve()
        .then(loader)
        .then((value) => {
          cached = { value, recordedAt: now() };
          return value;
        })
        .finally(() => {
          inFlight = null;
        });
      return inFlight;
    },
    clear() {
      cached = null;
    },
  };
}
