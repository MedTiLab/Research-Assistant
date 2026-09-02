type OutboundMessage = Record<string, any>;

export type OutboundQueueEntry = {
  payload: string;
  type: string;
  queuedAt: number;
  expiresAt: number;
  bytes: number;
  coalesceKey: string | null;
  clientOperationId: string | null;
};

const MUTATING_MESSAGE_TYPES = new Set([
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
]);

const SHORT_LIVED_MESSAGE_TYPES = new Set([
  'get-active-sessions',
  'check-session-status',
  'agent-turn-queue-status',
  'telemetry-settings',
]);

const REPLACEABLE_MUTATION_TYPES = new Set([
  'agent-turn-update',
  'agent-turn-reorder',
  'abort-session',
  'claude-permission-response',
]);

const DEFAULT_QUERY_TTL_MS = 30_000;
const DEFAULT_MUTATION_TTL_MS = 5 * 60_000;

const createOperationId = () => {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
};

const normalizedPart = (value: unknown) => typeof value === 'string' ? value.trim() : '';

const getCoalesceKey = (message: OutboundMessage): string | null => {
  const type = normalizedPart(message.type);
  if (!SHORT_LIVED_MESSAGE_TYPES.has(type) && !REPLACEABLE_MUTATION_TYPES.has(type)) return null;
  if (type === 'telemetry-settings' || type === 'get-active-sessions') return type;
  return [
    type,
    normalizedPart(message.provider),
    normalizedPart(message.sessionId),
    normalizedPart(message.itemId),
    normalizedPart(message.requestId),
  ].join(':');
};

const byteLength = (value: string) => new TextEncoder().encode(value).byteLength;

export function createOutboundQueueEntry(
  message: OutboundMessage,
  {
    now = Date.now(),
    operationIdFactory = createOperationId,
  }: {
    now?: number;
    operationIdFactory?: () => string;
  } = {},
): OutboundQueueEntry {
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    throw new TypeError('WebSocket message must be an object');
  }

  const type = normalizedPart(message.type);
  const clientOperationId = MUTATING_MESSAGE_TYPES.has(type)
    ? normalizedPart(message.clientOperationId) || operationIdFactory()
    : null;
  const normalizedMessage = clientOperationId
    ? { ...message, clientOperationId }
    : message;
  const payload = JSON.stringify(normalizedMessage);
  const ttlMs = SHORT_LIVED_MESSAGE_TYPES.has(type)
    ? DEFAULT_QUERY_TTL_MS
    : DEFAULT_MUTATION_TTL_MS;

  return {
    payload,
    type,
    queuedAt: now,
    expiresAt: now + ttlMs,
    bytes: byteLength(payload),
    coalesceKey: getCoalesceKey(normalizedMessage),
    clientOperationId,
  };
}

export function pruneExpiredOutboundMessages(
  queue: OutboundQueueEntry[],
  now = Date.now(),
): number {
  let removed = 0;
  for (let index = queue.length - 1; index >= 0; index -= 1) {
    if (queue[index].expiresAt <= now) {
      queue.splice(index, 1);
      removed += 1;
    }
  }
  return removed;
}

export function enqueueOutboundMessage(
  queue: OutboundQueueEntry[],
  entry: OutboundQueueEntry,
  {
    now = Date.now(),
    maxEntries = 100,
    maxBytes = 32 * 1024 * 1024,
  }: {
    now?: number;
    maxEntries?: number;
    maxBytes?: number;
  } = {},
) {
  const expired = pruneExpiredOutboundMessages(queue, now);
  let coalesced = 0;
  if (entry.coalesceKey) {
    for (let index = queue.length - 1; index >= 0; index -= 1) {
      if (queue[index].coalesceKey === entry.coalesceKey) {
        queue.splice(index, 1);
        coalesced += 1;
      }
    }
  }

  const currentBytes = () => queue.reduce((total, item) => total + item.bytes, 0);
  while (
    queue.length > 0
    && (queue.length + 1 > maxEntries || currentBytes() + entry.bytes > maxBytes)
  ) {
    const replaceableIndex = queue.findIndex((item) => Boolean(item.coalesceKey));
    if (replaceableIndex < 0) break;
    queue.splice(replaceableIndex, 1);
    coalesced += 1;
  }

  if (queue.length + 1 > maxEntries || currentBytes() + entry.bytes > maxBytes) {
    return { accepted: false, expired, coalesced };
  }

  queue.push(entry);
  return { accepted: true, expired, coalesced };
}

export const OUTBOUND_QUEUE_DEFAULTS = Object.freeze({
  maxEntries: 100,
  maxBytes: 32 * 1024 * 1024,
});
