import crypto from 'crypto';
import {
  createAgentSessionIdentity,
  createAgentSessionKey,
  normalizeRuntimeId,
} from '../utils/agentSessionIdentity.js';
import { normalizeAgentRuntimeEvents, normalizeRuntimeObservations } from './observations/index.js';
import { getRequiredAgentRuntime } from './registry.js';

function createTurnError(code, message, metadata = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, metadata);
  return error;
}

function normalizeOptionalString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function freezeSnapshot(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(freezeSnapshot);
  return Object.freeze(value);
}

function createTurnSnapshot({ turnId, identity, request, createdAt }) {
  const options = request.options && typeof request.options === 'object' ? request.options : {};
  const modelSelection = request.modelSelection && typeof request.modelSelection === 'object'
    ? request.modelSelection
    : {};
  return freezeSnapshot({
    turnId,
    identity: { ...identity },
    runtimeId: identity.runtimeId,
    modelProviderId: normalizeOptionalString(
      modelSelection.modelProviderId ?? options.modelProviderId,
    ),
    modelId: normalizeOptionalString(modelSelection.modelId ?? options.model),
    modelApi: normalizeOptionalString(modelSelection.modelApi ?? options.modelApi),
    catalogRevision: Number.isInteger(modelSelection.catalogRevision)
      ? modelSelection.catalogRevision
      : (Number.isInteger(options.catalogRevision) ? options.catalogRevision : null),
    projectRoot: normalizeOptionalString(options.projectPath ?? options.cwd),
    permissionMode: normalizeOptionalString(options.permissionMode),
    reasoningLevel: normalizeOptionalString(
      options.reasoningLevel ?? options.modelReasoningEffort,
    ),
    clientOperationId: normalizeOptionalString(request.clientOperationId),
    createdAt,
  });
}

function normalizeTurnRequest(request, turnId) {
  if (!request || typeof request !== 'object') {
    throw createTurnError('AGENT_TURN_INVALID', 'Agent turn request must be an object.');
  }
  const runtimeId = normalizeRuntimeId(request.runtimeId ?? request.identity?.runtimeId);
  if (!runtimeId) {
    throw createTurnError('AGENT_RUNTIME_NOT_FOUND', 'A registered runtimeId is required.', {
      runtimeId: null,
    });
  }
  const requestedIdentity = request.identity && typeof request.identity === 'object'
    ? request.identity
    : {};
  const identityRuntimeId = normalizeRuntimeId(requestedIdentity.runtimeId ?? runtimeId);
  if (identityRuntimeId !== runtimeId) {
    throw createTurnError(
      'AGENT_SESSION_IDENTITY_MISMATCH',
      `Turn runtime "${runtimeId}" does not match identity runtime "${identityRuntimeId}".`,
      { runtimeId },
    );
  }
  const sessionId = normalizeOptionalString(requestedIdentity.sessionId)
    || normalizeOptionalString(request.options?.sessionId)
    || normalizeOptionalString(request.options?.clientSessionId)
    || `new-session-${turnId}`;
  const identity = createAgentSessionIdentity({
    ...requestedIdentity,
    runtimeId,
    sessionId,
  });
  return {
    ...request,
    identity,
    runtimeId,
    command: typeof request.command === 'string' ? request.command : '',
    options: request.options && typeof request.options === 'object' ? { ...request.options } : {},
  };
}

function createObservationWriter(writer, record, hooks, pendingTasks) {
  if (!writer || typeof writer !== 'object' || typeof writer.send !== 'function') return writer;
  return new Proxy(writer, {
    get(target, property) {
      if (property === 'send') {
        return (payload) => {
          let agentEvents = [];
          try {
            agentEvents = normalizeAgentRuntimeEvents(payload, {
              provider: record.runtimeId,
              sessionId: record.identity?.sessionId || null,
              runId: record.turnId,
            });
          } catch (error) {
            console.warn('[agent-turn] Failed to normalize agent runtime events:', error.message);
          }
          if (typeof hooks.onObservations === 'function') {
            try {
              const observations = normalizeRuntimeObservations(payload);
              if (observations.length > 0) {
                const task = Promise.resolve(hooks.onObservations(observations, record));
                pendingTasks.add(task);
                task.then(
                  () => pendingTasks.delete(task),
                  () => pendingTasks.delete(task),
                );
              }
            } catch (error) {
              console.warn('[agent-turn] Failed to normalize runtime observations:', error.message);
            }
          }
          if (agentEvents.length > 0 && payload && typeof payload === 'object' && !Array.isArray(payload)) {
            return target.send({ ...payload, agentEvents });
          }
          return target.send(payload);
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
    set(target, property, value) {
      return Reflect.set(target, property, value, target);
    },
  });
}

async function runCleanupHook(hook, context, name) {
  if (typeof hook !== 'function') return;
  try {
    await hook(context);
  } catch (error) {
    console.warn(`[agent-turn] ${name} hook failed:`, error.message);
  }
}

export function createAgentTurnCoordinator({
  getRuntime = getRequiredAgentRuntime,
  now = () => Date.now(),
  createTurnId = () => crypto.randomUUID(),
} = {}) {
  const aliases = new Map();
  const records = new Set();

  const addAlias = (record, identity) => {
    const normalizedIdentity = createAgentSessionIdentity(identity);
    const sessionKey = createAgentSessionKey(normalizedIdentity);
    const existing = aliases.get(sessionKey);
    if (existing && existing !== record && existing.status !== 'settled') {
      throw createTurnError(
        'AGENT_TURN_ALREADY_ACTIVE',
        `Agent session "${normalizedIdentity.sessionId}" is already processing.`,
        { runtimeId: normalizedIdentity.runtimeId, sessionKey },
      );
    }
    aliases.set(sessionKey, record);
    record.aliases.add(sessionKey);
    record.identity = normalizedIdentity;
    record.sessionKey = sessionKey;
    return normalizedIdentity;
  };

  const removeRecord = (record) => {
    record.status = 'settled';
    record.settledAt = new Date(now()).toISOString();
    for (const sessionKey of record.aliases) {
      if (aliases.get(sessionKey) === record) aliases.delete(sessionKey);
    }
    records.delete(record);
  };

  const get = (identity) => {
    try {
      return aliases.get(createAgentSessionKey(createAgentSessionIdentity(identity))) || null;
    } catch {
      return null;
    }
  };

  const findUnique = (runtimeId, sessionId) => {
    const normalizedRuntimeId = normalizeRuntimeId(runtimeId);
    const normalizedSessionId = normalizeOptionalString(sessionId);
    if (!normalizedRuntimeId || !normalizedSessionId) return null;
    const matches = [...records].filter((record) => (
      record.status !== 'settled'
      && record.identity.runtimeId === normalizedRuntimeId
      && record.identity.sessionId === normalizedSessionId
    ));
    return matches.length === 1 ? matches[0] : null;
  };

  const execute = async (rawRequest, writer = null, hooks = {}) => {
    const turnId = createTurnId();
    const request = normalizeTurnRequest(rawRequest, turnId);
    const runtime = getRuntime(request.runtimeId);
    const isResume = request.resume === true || Boolean(request.options.sessionId);
    if (isResume && runtime.capabilities?.sessionResume !== true) {
      throw createTurnError(
        'AGENT_RUNTIME_CAPABILITY_UNSUPPORTED',
        `Agent runtime "${request.runtimeId}" does not support session resume.`,
        { runtimeId: request.runtimeId, capability: 'sessionResume' },
      );
    }

    const authorization = typeof hooks.authorize === 'function'
      ? await hooks.authorize({ request, runtime })
      : true;
    if (authorization === false || authorization?.allowed === false) {
      throw createTurnError(
        authorization?.code || 'AGENT_RUNTIME_ENTITLEMENT_DENIED',
        authorization?.reason || `Access to runtime "${request.runtimeId}" is denied.`,
        { runtimeId: request.runtimeId },
      );
    }

    if (get(request.identity)) {
      throw createTurnError(
        'AGENT_TURN_ALREADY_ACTIVE',
        `Agent session "${request.identity.sessionId}" is already processing.`,
        {
          runtimeId: request.runtimeId,
          sessionKey: createAgentSessionKey(request.identity),
        },
      );
    }

    const startedAtMs = now();
    const snapshot = createTurnSnapshot({
      turnId,
      identity: request.identity,
      request,
      createdAt: new Date(startedAtMs).toISOString(),
    });
    const record = {
      turnId,
      identity: request.identity,
      sessionKey: createAgentSessionKey(request.identity),
      runtimeSessionKey: createAgentSessionKey(request.identity),
      runtime,
      runtimeId: request.runtimeId,
      snapshot,
      aliases: new Set(),
      status: 'starting',
      startedAt: startedAtMs,
      settledAt: null,
    };
    addAlias(record, request.identity);
    records.add(record);

    let runtimeWriter = writer;
    let prepared = null;
    let result;
    let failure = null;
    let outcome = 'completed';
    const pendingTasks = new Set();

    const resolveIdentity = (sessionId) => {
      const normalizedSessionId = normalizeOptionalString(sessionId);
      if (!normalizedSessionId) return record.identity;
      const resolvedIdentity = addAlias(record, {
        ...record.identity,
        sessionId: normalizedSessionId,
      });
      Promise.resolve(hooks.onIdentityResolved?.(resolvedIdentity, record)).catch((error) => {
        console.warn('[agent-turn] Identity resolution hook failed:', error.message);
      });
      return resolvedIdentity;
    };

    try {
      await hooks.validate?.({ request, runtime, record });
      runtimeWriter = await hooks.createWriter?.({ request, runtime, record, writer }) || writer;
      await hooks.beginQueue?.({ request, runtime, record, writer: runtimeWriter });
      prepared = await hooks.prepare?.({
        request,
        runtime,
        record,
        writer: runtimeWriter,
      }) || {};

      const originalLifecycleHandler = prepared.options?.onLifecycleEvent
        || request.options.onLifecycleEvent;
      const runtimeOptions = {
        ...request.options,
        ...(prepared.options || {}),
        sessionKey: record.runtimeSessionKey,
        identity: record.identity,
        turnId,
        turnSnapshot: snapshot,
        onLifecycleEvent: (event = {}) => {
          if (event.sessionId) resolveIdentity(event.sessionId);
          if (event.phase === 'turn_started') record.status = 'running';
          if (event.phase === 'completed') record.status = 'completing';
          try {
            originalLifecycleHandler?.(event);
          } finally {
            hooks.onLifecycleEvent?.(event, record);
          }
          if (typeof hooks.persistSession === 'function' && event.sessionId) {
            const task = Promise.resolve(hooks.persistSession(record.identity, event, record));
            pendingTasks.add(task);
            task.then(
              () => pendingTasks.delete(task),
              () => pendingTasks.delete(task),
            );
          }
        },
      };
      const coordinatedWriter = createObservationWriter(
        prepared.writer || runtimeWriter,
        record,
        hooks,
        pendingTasks,
      );
      const runtimeMethod = isResume ? 'resume' : 'start';
      record.status = 'running';
      result = await runtime[runtimeMethod](
        typeof prepared.command === 'string' ? prepared.command : request.command,
        runtimeOptions,
        coordinatedWriter,
      );
      return result;
    } catch (error) {
      failure = error;
      outcome = error?.name === 'AbortError' ? 'aborted' : 'error';
      throw error;
    } finally {
      const context = {
        request,
        runtime,
        record,
        prepared,
        result,
        error: failure,
        outcome,
        identity: record.identity,
        writer: runtimeWriter,
      };
      if (pendingTasks.size > 0) await Promise.allSettled([...pendingTasks]);
      await runCleanupHook(hooks.completeQueue, context, 'completeQueue');
      await runCleanupHook(hooks.settleReconnect, context, 'settleReconnect');
      await runCleanupHook(hooks.finalize, context, 'finalize');
      removeRecord(record);
    }
  };

  return Object.freeze({
    execute,
    get,
    findUnique,
    list: () => [...records],
  });
}

export const agentTurnCoordinator = createAgentTurnCoordinator();

export const executeAgentTurn = (...args) => agentTurnCoordinator.execute(...args);
export const getCoordinatedAgentTurn = (identity) => agentTurnCoordinator.get(identity);
export const findUniqueCoordinatedAgentTurn = (runtimeId, sessionId) => (
  agentTurnCoordinator.findUnique(runtimeId, sessionId)
);
export const listCoordinatedAgentTurns = () => agentTurnCoordinator.list();
