import crypto from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { createAgentSessionIdentity } from '../utils/agentSessionIdentity.js';
import { resolveAppDataRoot } from '../utils/storagePaths.js';
import { createPiRuntimeError, redactPiHostMessage } from './rpc-client.js';

const MAX_AUDIT_STRING_LENGTH = 32_000;
const MAX_AUDIT_ARRAY_LENGTH = 100;
const MAX_AUDIT_OBJECT_KEYS = 200;
const SENSITIVE_KEY = /(?:authorization|proxy-authorization|cookie|set-cookie|api[-_]?key|token|secret|password|passwd|credential|private[-_]?key|headers?)/i;

function hash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 20);
}

function redactKnownSecrets(value, secrets) {
  let redacted = redactPiHostMessage(value)
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, '[REDACTED]')
    .replace(/\bgh[opusr]_[A-Za-z0-9_]{12,}\b/g, '[REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED]');
  for (const secret of secrets) {
    if (secret.length >= 6) redacted = redacted.split(secret).join('[REDACTED]');
  }
  if (redacted.length > MAX_AUDIT_STRING_LENGTH) {
    return `${redacted.slice(0, MAX_AUDIT_STRING_LENGTH)}…[TRUNCATED]`;
  }
  return redacted;
}

export function redactPiAuditValue(value, options = {}, state = { depth: 0, seen: new WeakSet() }) {
  const secrets = options.secrets instanceof Set
    ? options.secrets
    : new Set((options.secrets || []).filter((entry) => typeof entry === 'string' && entry));
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return redactKnownSecrets(value, secrets);
  if (typeof value === 'bigint') return String(value);
  if (typeof value !== 'object') return `[${typeof value}]`;
  if (state.depth >= 12) return '[MAX_DEPTH]';
  if (state.seen.has(value)) return '[CIRCULAR]';
  state.seen.add(value);
  const nextState = { depth: state.depth + 1, seen: state.seen };
  if (Array.isArray(value)) {
    const result = value.slice(0, MAX_AUDIT_ARRAY_LENGTH)
      .map((entry) => redactPiAuditValue(entry, { secrets }, nextState));
    if (value.length > MAX_AUDIT_ARRAY_LENGTH) result.push('[TRUNCATED]');
    return result;
  }
  const result = {};
  const entries = Object.entries(value).slice(0, MAX_AUDIT_OBJECT_KEYS);
  for (const [key, entry] of entries) {
    result[key] = SENSITIVE_KEY.test(key)
      ? '[REDACTED]'
      : redactPiAuditValue(entry, { secrets }, nextState);
  }
  if (Object.keys(value).length > MAX_AUDIT_OBJECT_KEYS) result.__truncated__ = true;
  return result;
}

export function resolvePiToolAuditPath(identity, options = {}) {
  const normalized = createAgentSessionIdentity(identity);
  return path.join(
    resolveAppDataRoot(options),
    'pi',
    'audit',
    hash(normalized.ownerKey),
    hash(normalized.projectKey),
    `${hash(normalized.sessionId)}.jsonl`,
  );
}

export class PiToolAuditLog {
  constructor(identity, options = {}) {
    this.identity = createAgentSessionIdentity(identity);
    this.filePath = resolvePiToolAuditPath(this.identity, options);
    this.now = options.now || (() => new Date().toISOString());
    this.secrets = new Set(
      Object.values(options.secretEnv || {}).filter((entry) => typeof entry === 'string' && entry),
    );
    this.queue = Promise.resolve();
  }

  append(event = {}) {
    const record = redactPiAuditValue({
      timestamp: this.now(),
      runtimeId: 'pi',
      sessionRef: hash(this.identity.sessionId),
      ...event,
    }, { secrets: this.secrets });
    const operation = this.queue.then(async () => {
      try {
        await fs.mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
        await fs.appendFile(this.filePath, `${JSON.stringify(record)}\n`, {
          encoding: 'utf8',
          mode: 0o600,
        });
      } catch (error) {
        throw createPiRuntimeError(
          'PI_TOOL_AUDIT_FAILED',
          `Pi tool audit could not be written: ${error?.message || error}`,
        );
      }
      return record;
    });
    this.queue = operation.catch(() => {});
    return operation;
  }

  flush() {
    return this.queue;
  }
}

export function createPiToolAuditLog(identity, options = {}) {
  return new PiToolAuditLog(identity, options);
}
