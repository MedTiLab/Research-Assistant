import crypto from 'crypto';
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { createRequire } from 'module';
import path from 'path';
import readline from 'readline';

const require = createRequire(import.meta.url);

let medhelpVersion = 'unknown';
try {
  medhelpVersion = require('../package.json')?.version || medhelpVersion;
} catch {}

const APP_SERVER_REQUEST_TIMEOUT_MS = 60_000;
const DEFAULT_TURN_IDLE_TIMEOUT_MS = 5 * 60_000;
const TURN_IDLE_SUSPENDING_ITEM_TYPES = new Set([
  'commandExecution',
  'mcpToolCall',
]);
const APP_SERVER_STDERR_LIMIT = 16_000;
const APP_SERVER_ENV_FINGERPRINT_IGNORED_KEYS = new Set([
  // This diagnostic timestamp is refreshed by the cloud connection probe about
  // once a minute. It does not change Codex authentication or subprocess
  // behavior, so including it would tear down an otherwise healthy app-server.
  'MEDHELP_DATABASE_API_CONNECTION_VERIFIED_AT',
  // Diagnostic metadata only. A source-count refresh must not replace the
  // long-lived Codex process while desktop windows are reconnecting.
  'MEDHELP_DATABASE_API_ACCESSIBLE_SOURCE_COUNT',
]);
const APP_SERVER_CLIENT_INFO = {
  name: 'medhelp',
  title: 'MedHelp',
  version: medhelpVersion,
};

const CODEX_PLATFORM_PACKAGES = {
  'darwin-arm64': ['@openai/codex-darwin-arm64', 'aarch64-apple-darwin'],
  'darwin-x64': ['@openai/codex-darwin-x64', 'x86_64-apple-darwin'],
  'linux-arm64': ['@openai/codex-linux-arm64', 'aarch64-unknown-linux-musl'],
  'linux-x64': ['@openai/codex-linux-x64', 'x86_64-unknown-linux-musl'],
  'win32-arm64': ['@openai/codex-win32-arm64', 'aarch64-pc-windows-msvc'],
  'win32-x64': ['@openai/codex-win32-x64', 'x86_64-pc-windows-msvc'],
};

function createAbortError(message = 'Codex turn was interrupted.') {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

class AsyncEventQueue {
  constructor() {
    this.values = [];
    this.waiters = [];
    this.closed = false;
    this.error = null;
  }

  push(value) {
    if (this.closed) return;
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter.resolve({ done: false, value });
      return;
    }
    this.values.push(value);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) {
      waiter.resolve({ done: true, value: undefined });
    }
  }

  fail(error) {
    if (this.closed) return;
    this.error = error instanceof Error ? error : new Error(String(error || 'Codex app-server failed'));
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) {
      waiter.reject(this.error);
    }
  }

  [Symbol.asyncIterator]() {
    return this;
  }

  next() {
    if (this.values.length > 0) {
      return Promise.resolve({ done: false, value: this.values.shift() });
    }
    if (this.error) {
      return Promise.reject(this.error);
    }
    if (this.closed) {
      return Promise.resolve({ done: true, value: undefined });
    }
    return new Promise((resolve, reject) => {
      this.waiters.push({ resolve, reject });
    });
  }

  return() {
    this.close();
    return Promise.resolve({ done: true, value: undefined });
  }
}

export function resolveBundledCodexExecutable(options = {}) {
  const environmentPath = options.ignoreEnvironment === true ? '' : process.env.CODEX_CLI_PATH;
  const explicitPath = String(options.executablePath || environmentPath || '').trim();
  if (explicitPath) {
    return explicitPath;
  }

  const platform = options.platform || process.platform;
  const arch = options.arch || process.arch;
  const packageInfo = CODEX_PLATFORM_PACKAGES[`${platform}-${arch}`];
  if (!packageInfo) {
    throw new Error(`Unsupported Codex app-server platform: ${platform} (${arch})`);
  }

  const [packageName, targetTriple] = packageInfo;
  const packageJsonPath = require.resolve(`${packageName}/package.json`);
  const executable = path.join(
    path.dirname(packageJsonPath),
    'vendor',
    targetTriple,
    'bin',
    platform === 'win32' ? 'codex.exe' : 'codex',
  );

  if (!existsSync(executable)) {
    throw new Error(`Bundled Codex executable was not found at ${executable}`);
  }
  return executable;
}

function normalizeThreadItem(item, state) {
  if (!item || typeof item !== 'object') return null;

  switch (item.type) {
    case 'agentMessage':
      state.agentMessages.set(item.id, item.text || state.agentMessages.get(item.id) || '');
      return { id: item.id, type: 'agent_message', text: item.text || '' };
    case 'reasoning': {
      const text = [...(item.summary || []), ...(item.content || [])].filter(Boolean).join('\n');
      state.reasoning.set(item.id, text);
      return { id: item.id, type: 'reasoning', text };
    }
    case 'commandExecution':
      state.commandOutputs.set(item.id, item.aggregatedOutput || state.commandOutputs.get(item.id) || '');
      return {
        id: item.id,
        type: 'command_execution',
        command: item.command || '',
        aggregated_output: item.aggregatedOutput || '',
        exit_code: item.exitCode,
        status: item.status === 'inProgress' ? 'in_progress' : item.status,
      };
    case 'fileChange':
      return {
        id: item.id,
        type: 'file_change',
        changes: item.changes || [],
        status: item.status === 'inProgress' ? 'in_progress' : item.status,
      };
    case 'mcpToolCall':
      return {
        id: item.id,
        type: 'mcp_tool_call',
        server: item.server,
        tool: item.tool,
        arguments: item.arguments,
        result: item.result,
        error: item.error,
        status: item.status === 'inProgress' ? 'in_progress' : item.status,
      };
    case 'webSearch':
      return { id: item.id, type: 'web_search', query: item.query || '' };
    case 'contextCompaction':
      return { id: item.id, type: 'reasoning', text: 'Compacting conversation context' };
    default:
      return { ...item, type: item.type || 'unknown' };
  }
}

function normalizeTokenUsage(tokenUsage) {
  const last = tokenUsage?.last;
  if (!last || typeof last !== 'object') return null;
  return {
    input_tokens: last.inputTokens || 0,
    cached_input_tokens: last.cachedInputTokens || 0,
    cache_write_input_tokens: last.cacheWriteInputTokens || 0,
    output_tokens: last.outputTokens || 0,
    reasoning_output_tokens: last.reasoningOutputTokens || 0,
    current_context_usage: {
      total_tokens: last.totalTokens || last.inputTokens || 0,
    },
    model_context_window: tokenUsage.modelContextWindow || null,
  };
}

function notificationToLegacyEvent(message, state) {
  const params = message?.params || {};

  switch (message?.method) {
    case 'turn/started':
      state.turnId = params.turn?.id || state.turnId;
      return { type: 'turn.started' };
    case 'item/started': {
      const item = normalizeThreadItem(params.item, state);
      return item ? { type: 'item.started', item } : null;
    }
    case 'item/completed': {
      const item = normalizeThreadItem(params.item, state);
      return item ? { type: 'item.completed', item } : null;
    }
    case 'item/agentMessage/delta': {
      const previous = state.agentMessages.get(params.itemId) || '';
      const text = `${previous}${params.delta || ''}`;
      state.agentMessages.set(params.itemId, text);
      return {
        type: 'item.updated',
        item: { id: params.itemId, type: 'agent_message', text },
      };
    }
    case 'item/reasoning/summaryTextDelta':
    case 'item/reasoning/textDelta': {
      const previous = state.reasoning.get(params.itemId) || '';
      const text = `${previous}${params.delta || ''}`;
      state.reasoning.set(params.itemId, text);
      return {
        type: 'item.updated',
        item: { id: params.itemId, type: 'reasoning', text },
      };
    }
    case 'item/commandExecution/outputDelta': {
      const previous = state.commandOutputs.get(params.itemId) || '';
      state.commandOutputs.set(params.itemId, `${previous}${params.delta || ''}`);
      return null;
    }
    case 'turn/plan/updated':
      return {
        type: 'item.updated',
        item: {
          id: `plan:${params.turnId || state.turnId || 'active'}`,
          type: 'todo_list',
          items: (params.plan || []).map((entry) => ({
            text: entry.step || '',
            status: entry.status === 'inProgress' ? 'in_progress' : entry.status || 'pending',
            completed: entry.status === 'completed',
          })),
        },
      };
    case 'thread/tokenUsage/updated':
      state.usage = normalizeTokenUsage(params.tokenUsage);
      return null;
    case 'error': {
      const error = params.error || {};
      return {
        type: 'error',
        message: error.message || 'Codex app-server reported an error',
        error,
      };
    }
    case 'turn/completed': {
      const status = params.turn?.status;
      if (status === 'failed') {
        return {
          type: 'turn.failed',
          error: params.turn?.error || { message: 'Codex turn failed' },
        };
      }
      return {
        type: 'turn.completed',
        usage: state.usage,
        status,
      };
    }
    default:
      return null;
  }
}

function defaultServerRequestResponse(method) {
  switch (method) {
    case 'item/commandExecution/requestApproval':
      return { decision: 'decline' };
    case 'item/fileChange/requestApproval':
      return { decision: 'decline' };
    case 'execCommandApproval':
    case 'applyPatchApproval':
      return { decision: { denied: { rejection: 'Interactive approval is not available in this MedHelp session.' } } };
    case 'tool/requestUserInput':
      return { answers: {} };
    case 'item/permissions/requestApproval':
      return { permissions: {}, scope: 'turn' };
    case 'mcpServer/elicitation/request':
      return { action: 'cancel', content: null };
    case 'item/tool/call':
      return { contentItems: [], success: false };
    default:
      return null;
  }
}

export class CodexAppServerClient {
  constructor(options = {}) {
    this.executablePath = options.executablePath || resolveBundledCodexExecutable(options);
    this.env = options.env || process.env;
    this.spawnImpl = options.spawnImpl || spawn;
    this.requestTimeoutMs = options.requestTimeoutMs || APP_SERVER_REQUEST_TIMEOUT_MS;
    this.turnIdleTimeoutMs = Number.isFinite(Number(options.turnIdleTimeoutMs))
      ? Math.max(0, Number(options.turnIdleTimeoutMs))
      : Math.max(
        0,
        Number.parseInt(this.env.CODEX_TURN_IDLE_TIMEOUT_MS || '', 10)
          || DEFAULT_TURN_IDLE_TIMEOUT_MS,
      );
    this.clientInfo = options.clientInfo || APP_SERVER_CLIENT_INFO;
    this.process = null;
    this.readline = null;
    this.pendingRequests = new Map();
    this.notificationHandlers = new Set();
    this.closeHandlers = new Set();
    this.nextRequestId = 1;
    this.stderrTail = '';
    this.closed = false;
    this.initialized = false;
    this.startPromise = null;
  }

  async start() {
    if (this.initialized && !this.closed) return this;
    if (this.startPromise) return this.startPromise;

    this.startPromise = (async () => {
      this.closed = false;
      this.process = this.spawnImpl(this.executablePath, ['app-server', '--listen', 'stdio://'], {
        env: this.env,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });

      this.process.once('error', (error) => this.#handleProcessFailure(error));
      this.process.once('exit', (code, signal) => {
        const suffix = this.stderrTail.trim() ? `: ${this.stderrTail.trim()}` : '';
        this.#handleProcessFailure(new Error(
          `Codex app-server exited${signal ? ` with signal ${signal}` : ` with code ${code ?? 'unknown'}`}${suffix}`,
        ));
      });

      this.process.stderr?.on('data', (chunk) => {
        this.stderrTail = `${this.stderrTail}${String(chunk)}`.slice(-APP_SERVER_STDERR_LIMIT);
      });

      this.readline = readline.createInterface({
        input: this.process.stdout,
        crlfDelay: Infinity,
      });
      this.readline.on('line', (line) => this.#handleLine(line));

      await this.request('initialize', {
        clientInfo: this.clientInfo,
      });
      this.notify('initialized', {});
      this.initialized = true;
      return this;
    })();

    try {
      return await this.startPromise;
    } catch (error) {
      await this.close().catch(() => {});
      throw error;
    } finally {
      this.startPromise = null;
    }
  }

  request(method, params = {}, options = {}) {
    if (this.closed) {
      return Promise.reject(new Error('Codex app-server is closed'));
    }
    const id = this.nextRequestId;
    this.nextRequestId += 1;
    const timeoutMs = options.timeoutMs || this.requestTimeoutMs;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Codex app-server request timed out: ${method}`));
      }, timeoutMs);
      timeout.unref?.();

      this.pendingRequests.set(id, { resolve, reject, timeout, method });
      try {
        this.#write({ method, id, params });
      } catch (error) {
        clearTimeout(timeout);
        this.pendingRequests.delete(id);
        reject(error);
      }
    });
  }

  notify(method, params = {}) {
    this.#write({ method, params });
  }

  onNotification(handler) {
    this.notificationHandlers.add(handler);
    return () => this.notificationHandlers.delete(handler);
  }

  onClose(handler) {
    this.closeHandlers.add(handler);
    return () => this.closeHandlers.delete(handler);
  }

  async startThread(params) {
    const result = await this.request('thread/start', params);
    return result?.thread || null;
  }

  async resumeThread(threadId, params = {}) {
    const result = await this.request('thread/resume', { threadId, ...params });
    return result?.thread || null;
  }

  async readThread(threadId) {
    const result = await this.request('thread/read', { threadId, includeTurns: true });
    return result?.thread || null;
  }

  async forkThread(threadId, params = {}) {
    const result = await this.request('thread/fork', { threadId, ...params });
    return result?.thread || null;
  }

  async unarchiveThread(threadId) {
    const result = await this.request('thread/unarchive', { threadId });
    return result?.thread || null;
  }

  async steerTurn({ threadId, turnId, input }) {
    const result = await this.request('turn/steer', {
      threadId,
      input,
      expectedTurnId: turnId,
    });
    return result?.turnId || turnId;
  }

  async runTurn({ threadId, input, turnOptions = {}, signal }) {
    const queue = new AsyncEventQueue();
    const state = {
      turnId: null,
      usage: null,
      agentMessages: new Map(),
      reasoning: new Map(),
      commandOutputs: new Map(),
      activeWorkItemIds: new Set(),
      abortRequested: signal?.aborted === true,
      completed: false,
    };

    let unsubscribeNotification = () => {};
    let unsubscribeClose = () => {};
    let abortHandler = null;
    let idleTimer = null;
    let cleanedUp = false;
    const clearIdleTimer = () => {
      if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = null;
      }
    };
    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      clearIdleTimer();
      unsubscribeNotification();
      unsubscribeClose();
      if (abortHandler && signal?.removeEventListener) {
        signal.removeEventListener('abort', abortHandler);
      }
    };

    const interrupt = async () => {
      state.abortRequested = true;
      if (!state.turnId) return;
      await this.request('turn/interrupt', {
        threadId,
        turnId: state.turnId,
      }).catch(() => {});
    };

    const failTurn = (error) => {
      if (state.completed || cleanedUp) return;
      cleanup();
      queue.fail(error);
      void interrupt();
    };

    const armIdleTimer = () => {
      clearIdleTimer();
      if (
        !(this.turnIdleTimeoutMs > 0)
        || state.completed
        || cleanedUp
        || state.activeWorkItemIds.size > 0
      ) return;
      idleTimer = setTimeout(() => {
        const error = new Error(
          `Codex stopped producing events for ${this.turnIdleTimeoutMs}ms; the turn was interrupted.`,
        );
        error.name = 'TimeoutError';
        error.code = 'TURN_IDLE_TIMEOUT';
        failTurn(error);
      }, this.turnIdleTimeoutMs);
      idleTimer.unref?.();
    };

    unsubscribeNotification = this.onNotification((message) => {
      const params = message?.params || {};
      if (params.threadId && params.threadId !== threadId) return;
      if (state.turnId && params.turnId && params.turnId !== state.turnId) return;

      // A long-running command or MCP call can be healthy while producing no
      // app-server notifications. Its own tool layer owns execution timeouts;
      // the turn-level idle watchdog must not race that timeout and interrupt
      // the model before it can receive and handle the tool result.
      if (
        message?.method === 'item/started'
        && params.item?.id
        && TURN_IDLE_SUSPENDING_ITEM_TYPES.has(params.item.type)
      ) {
        state.activeWorkItemIds.add(params.item.id);
      } else if (message?.method === 'item/completed' && params.item?.id) {
        state.activeWorkItemIds.delete(params.item.id);
      }

      // Count every matching app-server notification as activity, including
      // command output and token updates that are intentionally not forwarded.
      armIdleTimer();

      const event = notificationToLegacyEvent(message, state);
      if (event) queue.push(event);
      if (message?.method === 'turn/completed') {
        state.completed = true;
        cleanup();
        queue.close();
      }
    });

    unsubscribeClose = this.onClose((error) => {
      cleanup();
      queue.fail(error);
    });

    abortHandler = () => {
      state.abortRequested = true;
      failTurn(createAbortError());
    };
    signal?.addEventListener?.('abort', abortHandler, { once: true });

    try {
      const result = await this.request('turn/start', {
        threadId,
        input,
        ...turnOptions,
      });
      state.turnId = result?.turn?.id || null;
      if (!state.turnId) {
        throw new Error('Codex app-server did not return a turn id');
      }
      if (state.abortRequested) {
        failTurn(createAbortError());
      } else {
        armIdleTimer();
      }
    } catch (error) {
      cleanup();
      queue.fail(signal?.aborted ? createAbortError() : error);
      throw signal?.aborted ? createAbortError() : error;
    }

    return {
      turnId: state.turnId,
      events: queue,
      interrupt,
    };
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    this.initialized = false;
    const error = new Error('Codex app-server was closed');
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pendingRequests.clear();
    for (const handler of Array.from(this.closeHandlers)) {
      try {
        handler(error);
      } catch {}
    }
    this.closeHandlers.clear();
    this.readline?.close();

    const child = this.process;
    this.process = null;
    if (child && child.exitCode == null) {
      await new Promise((resolve) => {
        let settled = false;
        let timeout = null;
        const finish = () => {
          if (settled) return;
          settled = true;
          if (timeout) clearTimeout(timeout);
          resolve();
        };
        child.once('exit', finish);
        try {
          child.kill('SIGTERM');
        } catch {
          finish();
        }
        timeout = setTimeout(() => {
          try {
            if (child.exitCode == null) child.kill('SIGKILL');
          } catch {}
          finish();
        }, 2_000);
        timeout.unref?.();
      });
    }
  }

  #write(message) {
    if (!this.process?.stdin || this.process.stdin.destroyed || this.process.stdin.writableEnded) {
      throw new Error('Codex app-server stdin is unavailable');
    }
    this.process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  #handleLine(line) {
    const trimmed = String(line || '').trim();
    if (!trimmed) return;
    let message;
    try {
      message = JSON.parse(trimmed);
    } catch {
      console.warn('[Codex app-server] Ignoring non-JSON stdout line');
      return;
    }

    if (Object.prototype.hasOwnProperty.call(message, 'id') && !message.method) {
      const pending = this.pendingRequests.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timeout);
      this.pendingRequests.delete(message.id);
      if (message.error) {
        const error = new Error(message.error.message || `Codex app-server request failed: ${pending.method}`);
        error.code = message.error.code;
        error.data = message.error.data;
        pending.reject(error);
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (Object.prototype.hasOwnProperty.call(message, 'id') && message.method) {
      const result = defaultServerRequestResponse(message.method);
      if (result == null) {
        this.#write({
          id: message.id,
          error: { code: -32601, message: `Unsupported MedHelp client request: ${message.method}` },
        });
      } else {
        this.#write({ id: message.id, result });
      }
      return;
    }

    if (message.method) {
      for (const handler of this.notificationHandlers) {
        try {
          handler(message);
        } catch (error) {
          console.warn('[Codex app-server] Notification handler failed:', error?.message || error);
        }
      }
    }
  }

  #handleProcessFailure(error) {
    if (this.closed) return;
    this.closed = true;
    this.initialized = false;
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pendingRequests.clear();
    for (const handler of Array.from(this.closeHandlers)) {
      try {
        handler(error);
      } catch {}
    }
    this.closeHandlers.clear();
  }
}

const appServerClients = new Map();
const appServerOwnerLocks = new Map();
const liveAppServerClients = new Set();

function isTruthyEnvironmentValue(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function resolveAppServerOwnerKey(userId, env) {
  // A Local Kernel belongs to one desktop app instance. All of its windows,
  // reconnects, authenticated requests, and local background jobs must share
  // the same Codex process. Cloud kernels remain isolated per user.
  if (isTruthyEnvironmentValue(env?.MEDHELP_LOCAL_KERNEL)) {
    return 'local-kernel';
  }
  return String(userId ?? 'local');
}

async function withAppServerOwnerLock(ownerKey, operation) {
  const previous = appServerOwnerLocks.get(ownerKey) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => {
    release = resolve;
  });
  appServerOwnerLocks.set(ownerKey, current);

  await previous.catch(() => {});
  try {
    return await operation();
  } finally {
    release();
    if (appServerOwnerLocks.get(ownerKey) === current) {
      appServerOwnerLocks.delete(ownerKey);
    }
  }
}

function buildEnvironmentFingerprint(env) {
  const entries = Object.entries(env || {})
    .filter(([name, value]) => (
      value != null && !APP_SERVER_ENV_FINGERPRINT_IGNORED_KEYS.has(name)
    ))
    .map(([name, value]) => [name, String(value)])
    .sort(([left], [right]) => left.localeCompare(right));
  return crypto.createHash('sha256').update(JSON.stringify(entries)).digest('hex');
}

export async function getCodexAppServerClient({
  userId,
  env,
  reuseExistingOnEnvMismatch = false,
  clientOptions = {},
} = {}) {
  const effectiveEnv = env || process.env;
  const ownerKey = resolveAppServerOwnerKey(userId, effectiveEnv);

  return withAppServerOwnerLock(ownerKey, async () => {
    const fingerprint = buildEnvironmentFingerprint(effectiveEnv);
    const existing = appServerClients.get(ownerKey);

    if (existing && (
      existing.fingerprint === fingerprint || reuseExistingOnEnvMismatch
    )) {
      const client = await existing.promise.catch(() => null);
      if (client && !client.closed) return client;
    }

    if (existing) {
      const oldClient = await existing.promise.catch(() => null);
      if (oldClient) {
        console.info(`[Codex app-server] Replacing pid=${oldClient.process?.pid ?? 'unknown'} owner=${ownerKey}`);
        await oldClient.close().catch(() => {});
      }
    }

    const client = new CodexAppServerClient({
      ...clientOptions,
      env: effectiveEnv,
    });
    liveAppServerClients.add(client);
    const promise = client.start();
    appServerClients.set(ownerKey, { fingerprint, promise });
    client.onClose(() => {
      liveAppServerClients.delete(client);
      const current = appServerClients.get(ownerKey);
      if (current?.promise === promise) appServerClients.delete(ownerKey);
    });

    try {
      const startedClient = await promise;
      console.info(`[Codex app-server] Started pid=${startedClient.process?.pid ?? 'unknown'} owner=${ownerKey}`);
      return startedClient;
    } catch (error) {
      liveAppServerClients.delete(client);
      const current = appServerClients.get(ownerKey);
      if (current?.promise === promise) appServerClients.delete(ownerKey);
      throw error;
    }
  });
}

export async function shutdownCodexAppServers() {
  const pendingLocks = Array.from(appServerOwnerLocks.values());
  await Promise.allSettled(pendingLocks);
  const clients = Array.from(liveAppServerClients);
  appServerClients.clear();
  liveAppServerClients.clear();
  await Promise.allSettled(clients.map((client) => client.close()));
}
