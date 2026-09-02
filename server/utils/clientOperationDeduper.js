const DEFAULT_PROTECTED_TYPES = new Set([
  'agent-command',
  'claude-command',
  'codex-command',
  'local-command',
  'agent-turn-steer',
  'agent-turn-enqueue',
  'agent-turn-update',
  'agent-turn-remove',
  'agent-turn-reorder',
  'agent-turn-clear',
  'abort-session',
  'claude-permission-response',
  'agent-permission-response',
]);

export function createClientOperationDeduper({
  ttlMs = 10 * 60_000,
  maxEntries = 5_000,
  now = Date.now,
  protectedTypes = DEFAULT_PROTECTED_TYPES,
} = {}) {
  const seen = new Map();

  const prune = (timestamp) => {
    for (const [key, expiresAt] of seen) {
      if (expiresAt <= timestamp) seen.delete(key);
    }
    while (seen.size > maxEntries) {
      const oldestKey = seen.keys().next().value;
      if (oldestKey == null) break;
      seen.delete(oldestKey);
    }
  };

  return {
    accept(ownerKey, message) {
      const type = typeof message?.type === 'string' ? message.type.trim() : '';
      const operationId = typeof message?.clientOperationId === 'string'
        ? message.clientOperationId.trim()
        : '';
      if (!protectedTypes.has(type) || !operationId || operationId.length > 160) {
        return { accepted: true, tracked: false, operationId: operationId || null };
      }

      const timestamp = now();
      prune(timestamp);
      const key = JSON.stringify([String(ownerKey || 'local'), type, operationId]);
      const existingExpiry = seen.get(key);
      if (existingExpiry && existingExpiry > timestamp) {
        return { accepted: false, tracked: true, operationId };
      }

      seen.set(key, timestamp + ttlMs);
      prune(timestamp);
      return { accepted: true, tracked: true, operationId };
    },

    get size() {
      return seen.size;
    },
  };
}
