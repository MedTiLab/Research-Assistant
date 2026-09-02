import crypto from 'node:crypto';

import { createAgentSessionIdentity, createAgentSessionKey } from '../utils/agentSessionIdentity.js';

const DEFAULT_WORKERS = 3;
const DEFAULT_LEASE_MS = 120_000;
const DEFAULT_HEARTBEAT_MS = 10_000;
const DEFAULT_REAPER_MS = 15_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const NON_RETRYABLE_CODES = new Set([
  'AGENT_RUNTIME_NOT_FOUND',
  'AGENT_RUNTIME_CAPABILITY_UNSUPPORTED',
  'AGENT_RUNTIME_ENTITLEMENT_DENIED',
  'AGENT_SESSION_IDENTITY_MISMATCH',
  'AGENT_TURN_INVALID',
  'AGENT_TURN_ALREADY_ACTIVE',
]);
const RETRYABLE_CODES = new Set([
  'AGENT_PROVIDER_UNAVAILABLE',
  'AGENT_PROVIDER_TIMEOUT',
  'AGENT_RATE_LIMITED',
  'PI_MANAGED_FREE_RATE_LIMITED',
  'PI_MANAGED_FREE_REFRESH_TIMEOUT',
  'PI_HOST_CRASHED',
  'PI_HOST_START_TIMEOUT',
]);

function positiveInteger(value, fallback, minimum = 1) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum ? parsed : fallback;
}

function delay(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

function serializeResult(value) {
  if (value === undefined) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return { type: typeof value, summary: String(value).slice(0, 1_000) };
  }
}

function persistedRequest(request, identity) {
  const options = request.options && typeof request.options === 'object' ? request.options : {};
  const modelSelection = request.modelSelection && typeof request.modelSelection === 'object'
    ? request.modelSelection
    : {};
  return {
    identity,
    runtimeId: identity.runtimeId,
    commandLength: String(request.command || '').length,
    options: {
      projectPath: typeof options.projectPath === 'string' ? options.projectPath : null,
      cwd: typeof options.cwd === 'string' ? options.cwd : null,
      sessionId: typeof options.sessionId === 'string' ? options.sessionId : null,
      clientSessionId: typeof options.clientSessionId === 'string' ? options.clientSessionId : null,
      permissionMode: typeof options.permissionMode === 'string' ? options.permissionMode : null,
      reasoningLevel: typeof options.reasoningLevel === 'string' ? options.reasoningLevel : null,
    },
    modelSelection: {
      modelProviderId: modelSelection.modelProviderId || null,
      modelId: modelSelection.modelId || null,
      modelApi: modelSelection.modelApi || null,
      catalogRevision: Number.isInteger(modelSelection.catalogRevision)
        ? modelSelection.catalogRevision
        : null,
    },
    clientOperationId: request.clientOperationId || null,
  };
}

function shouldRetry(error) {
  if (!error || error.name === 'AbortError') return false;
  if (error.retryable === false || error.isRetryable === false) return false;
  if (NON_RETRYABLE_CODES.has(error.code)) return false;
  return error.retryable === true
    || error.isRetryable === true
    || RETRYABLE_CODES.has(error.code);
}

function createEngineError(code, message, metadata = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, metadata);
  return error;
}

export function createAgentRunEngine({
  store,
  execute,
  cancelRun = null,
  workers = positiveInteger(process.env.AGENT_WORKERS, DEFAULT_WORKERS),
  leaseMs = positiveInteger(process.env.AGENT_RUN_LEASE_MS, DEFAULT_LEASE_MS, 1_000),
  heartbeatMs = positiveInteger(process.env.AGENT_RUN_HEARTBEAT_MS, DEFAULT_HEARTBEAT_MS, 250),
  reaperMs = positiveInteger(process.env.AGENT_RUN_REAPER_MS, DEFAULT_REAPER_MS, 1_000),
  maxAttempts = positiveInteger(process.env.AGENT_RUN_MAX_ATTEMPTS, DEFAULT_MAX_ATTEMPTS),
  pollMs = 100,
} = {}) {
  if (!store || typeof store.create !== 'function' || typeof store.claim !== 'function') {
    throw new TypeError('Agent run engine requires an agent run store.');
  }
  if (typeof execute !== 'function') {
    throw new TypeError('Agent run engine requires an execute function.');
  }

  const instanceId = `agent-${process.pid}-${crypto.randomUUID().slice(0, 8)}`;
  const liveJobs = new Map();
  const workerLoops = new Map();
  const activeClaims = new Map();
  const wakeWaiters = new Set();
  let accepting = false;
  let started = false;
  let stopping = false;
  let generation = 0;
  let reaperTimer = null;
  let lastReap = { scanned: 0, requeued: 0, parked: 0 };

  const wake = () => {
    for (const resolve of wakeWaiters) resolve();
    wakeWaiters.clear();
  };

  const waitForWork = () => new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      wakeWaiters.delete(finish);
      resolve();
    };
    const timer = setTimeout(finish, pollMs);
    timer.unref?.();
    wakeWaiters.add(finish);
  });

  const settleJob = (runId, method, value) => {
    const job = liveJobs.get(runId);
    if (!job) return;
    liveJobs.delete(runId);
    job[method](value);
  };

  const runClaim = async (workerId, run) => {
    const job = liveJobs.get(run.id);
    if (!job) {
      store.park(run.id, run.leaseToken, {
        code: 'AGENT_RUN_PAYLOAD_UNAVAILABLE',
        message: 'The backend restarted without the private in-memory execution context; submit a manual retry.',
      });
      return;
    }

    activeClaims.set(run.id, { workerId, leaseToken: run.leaseToken, sessionKey: run.sessionKey });
    let leaseLost = false;
    let consecutiveLost = 0;
    const heartbeat = setInterval(() => {
      try {
        if (store.heartbeat(run.id, run.leaseToken, leaseMs)) {
          consecutiveLost = 0;
        } else {
          consecutiveLost += 1;
          if (consecutiveLost >= 3) leaseLost = true;
        }
      } catch (error) {
        console.warn('[agent-run] heartbeat failed:', error.message);
      }
    }, heartbeatMs);
    heartbeat.unref?.();

    try {
      const result = await execute(job.request, job.writer, job.hooks);
      if (leaseLost) {
        throw createEngineError(
          'AGENT_RUN_LEASE_LOST',
          'The agent run lost its execution lease before completion.',
        );
      }
      if (!store.complete(run.id, run.leaseToken, serializeResult(result))) {
        throw createEngineError(
          'AGENT_RUN_LEASE_LOST',
          'The agent run could not commit because its lease is no longer valid.',
        );
      }
      settleJob(run.id, 'resolve', result);
    } catch (error) {
      const failure = store.fail(run.id, run.leaseToken, error, { retry: shouldRetry(error) });
      if (failure.requeued && !stopping) {
        wake();
      } else {
        settleJob(run.id, 'reject', error);
      }
    } finally {
      clearInterval(heartbeat);
      activeClaims.delete(run.id);
    }
  };

  const workerLoop = async (index, workerGeneration) => {
    const workerId = `${instanceId}-w${index + 1}`;
    while (!stopping && workerGeneration === generation) {
      let run = null;
      try {
        run = store.claim(workerId, leaseMs);
      } catch (error) {
        console.error('[agent-run] claim failed:', error.message);
        await delay(Math.min(pollMs * 10, 2_000));
        continue;
      }
      if (!run) {
        await waitForWork();
        continue;
      }
      await runClaim(workerId, run);
    }
  };

  const engine = {
    start() {
      if (started && !stopping) return engine.status();
      if (stopping) throw createEngineError('AGENT_RUN_ENGINE_STOPPING', 'Agent run engine is stopping.');
      started = true;
      accepting = true;
      generation += 1;
      const workerGeneration = generation;
      lastReap = store.recoverOrphans([...activeClaims.keys()]);
      for (let index = 0; index < workers; index += 1) {
        const loop = workerLoop(index, workerGeneration).catch((error) => {
          console.error(`[agent-run] worker ${index + 1} stopped:`, error.message);
        });
        workerLoops.set(index, loop);
        loop.finally(() => {
          if (workerLoops.get(index) === loop) workerLoops.delete(index);
        });
      }
      reaperTimer = setInterval(() => {
        try {
          lastReap = store.reapExpired();
          if (lastReap.requeued > 0) wake();
        } catch (error) {
          console.error('[agent-run] reaper failed:', error.message);
        }
      }, reaperMs);
      reaperTimer.unref?.();
      wake();
      return engine.status();
    },

    submit(rawRequest, writer = null, hooks = {}, options = {}) {
      if (!started) engine.start();
      if (!accepting || stopping) {
        return Promise.reject(createEngineError('AGENT_RUN_ENGINE_STOPPING', 'Agent run engine is not accepting work.'));
      }
      const identity = createAgentSessionIdentity({
        ...(rawRequest.identity || {}),
        runtimeId: rawRequest.runtimeId || rawRequest.identity?.runtimeId,
        sessionId: rawRequest.identity?.sessionId
          || rawRequest.options?.sessionId
          || rawRequest.options?.clientSessionId
          || `new-session-${crypto.randomUUID()}`,
      });
      const sessionKey = createAgentSessionKey(identity);
      if ([...liveJobs.values()].some((job) => job.sessionKey === sessionKey)) {
        return Promise.reject(createEngineError(
          'AGENT_TURN_ALREADY_ACTIVE',
          `Agent session "${identity.sessionId}" is already queued or processing.`,
          { runtimeId: identity.runtimeId, sessionKey },
        ));
      }
      const request = { ...rawRequest, identity, runtimeId: identity.runtimeId };
      const run = store.create({
        ownerKey: identity.ownerKey,
        projectKey: identity.projectKey,
        runtimeId: identity.runtimeId,
        sessionKey,
        sessionId: identity.sessionId,
        commandPreview: request.command,
        request: persistedRequest(request, identity),
        maxAttempts: options.maxAttempts || maxAttempts,
        retryable: options.retryable !== false,
        recoveryPolicy: options.recoveryPolicy || 'park',
      });
      const promise = new Promise((resolve, reject) => {
        liveJobs.set(run.id, {
          request,
          writer,
          hooks,
          sessionKey,
          resolve,
          reject,
        });
      });
      Object.defineProperty(promise, 'runId', { value: run.id, enumerable: true });
      wake();
      return promise;
    },

    async cancel(runId, ownerKey = null) {
      const run = store.get(runId);
      if (!run || (ownerKey !== null && String(ownerKey) !== run.ownerKey)) return false;
      if (run.status === 'running' && typeof cancelRun === 'function') {
        await Promise.resolve(cancelRun(run)).catch((error) => {
          console.warn('[agent-run] runtime cancellation failed:', error.message);
        });
      }
      const cancelled = store.cancel(runId, ownerKey);
      if (cancelled) {
        settleJob(runId, 'reject', createEngineError('AGENT_RUN_CANCELLED', 'Agent run was cancelled.'));
      }
      return cancelled;
    },

    get(runId) {
      return store.get(runId);
    },

    list(options) {
      return store.list(options);
    },

    status() {
      const stats = store.stats();
      return {
        started,
        accepting,
        stopping,
        instanceId,
        configuredWorkers: workers,
        liveWorkers: workerLoops.size,
        activeRuns: activeClaims.size,
        bufferedRuns: liveJobs.size,
        leaseMs,
        heartbeatMs,
        reaperMs,
        lastReap,
        ...stats,
      };
    },

    beginDrain() {
      if (!started || stopping) return engine.status();
      accepting = false;
      stopping = true;
      generation += 1;
      if (reaperTimer) clearInterval(reaperTimer);
      reaperTimer = null;
      wake();
      return engine.status();
    },

    async stop({ drainMs = 5_000 } = {}) {
      if (!started) return;
      engine.beginDrain();
      let drained = false;
      const drainPromise = Promise.allSettled([...workerLoops.values()]).then(() => {
        drained = true;
        if (!started) stopping = false;
      });
      await Promise.race([
        drainPromise,
        delay(Math.max(0, drainMs)),
      ]);
      for (const [runId, claim] of activeClaims) {
        store.release(runId, claim.leaseToken);
      }
      for (const [runId, job] of liveJobs) {
        job.reject(createEngineError(
          'AGENT_RUN_ENGINE_STOPPED',
          'The backend stopped before the agent run completed.',
          { runId },
        ));
      }
      liveJobs.clear();
      activeClaims.clear();
      workerLoops.clear();
      started = false;
      if (drained) stopping = false;
    },
  };

  return Object.freeze(engine);
}
