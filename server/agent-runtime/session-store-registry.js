const REQUIRED_SESSION_STORE_METHODS = Object.freeze([
  'list',
  'read',
  'rename',
  'trash',
  'restore',
  'delete',
  'getUsage',
  'reconcile',
  'watchRoots',
]);

function normalizeRuntimeId(runtimeId) {
  return typeof runtimeId === 'string' && runtimeId.trim()
    ? runtimeId.trim().toLowerCase()
    : null;
}

export function assertRuntimeSessionStore(store) {
  if (!store || typeof store !== 'object') {
    throw new TypeError('Runtime session store must be an object.');
  }
  const runtimeId = normalizeRuntimeId(store.runtimeId);
  if (!runtimeId) {
    throw new TypeError('Runtime session store requires a non-empty runtimeId.');
  }
  for (const method of REQUIRED_SESSION_STORE_METHODS) {
    if (typeof store[method] !== 'function') {
      throw new TypeError(`Runtime session store "${runtimeId}" requires method "${method}".`);
    }
  }
  return store;
}

export function createRuntimeSessionStoreRegistry(initialStores = []) {
  const stores = new Map();

  const registry = {
    register(store) {
      assertRuntimeSessionStore(store);
      const runtimeId = normalizeRuntimeId(store.runtimeId);
      if (stores.has(runtimeId)) {
        const error = new Error(`Runtime session store "${runtimeId}" is already registered.`);
        error.code = 'RUNTIME_SESSION_STORE_ALREADY_REGISTERED';
        error.runtimeId = runtimeId;
        throw error;
      }
      stores.set(runtimeId, store);
      return store;
    },

    get(runtimeId) {
      return stores.get(normalizeRuntimeId(runtimeId)) || null;
    },

    require(runtimeId) {
      const normalizedRuntimeId = normalizeRuntimeId(runtimeId);
      const store = stores.get(normalizedRuntimeId);
      if (!store) {
        const error = new Error(`Runtime session store "${normalizedRuntimeId || runtimeId}" is not registered.`);
        error.code = 'RUNTIME_SESSION_STORE_NOT_FOUND';
        error.runtimeId = normalizedRuntimeId;
        throw error;
      }
      return store;
    },

    listRuntimeIds() {
      return Array.from(stores.keys());
    },
  };

  for (const store of initialStores) registry.register(store);
  return Object.freeze(registry);
}

export { REQUIRED_SESSION_STORE_METHODS };
